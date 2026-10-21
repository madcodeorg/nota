import { Checkbox } from '@nota/component';
import { DocsService } from '@nota/core/modules/doc';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useLiveData, useService } from '@nota/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useEffect, useMemo, useRef, useState } from 'react';
import { debounceTime } from 'rxjs';

import {
  buildEdges,
  createNodes,
  type GraphEdge,
  type GraphNode,
  nodeRadius,
  tick,
} from './graph-layout';
import * as styles from './index.css';

type Link = { from: string; to: string };
type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

const MAX_LINK_BLOCKS = 10000;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ALWAYS_LABELED = 15;

function allValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function resolveColor(element: Element, value: string, fallback: string) {
  const name = /var\((--[^,)]+)/.exec(value)?.[1];
  if (!name) return value;
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

const GraphCanvas = ({
  graph,
  onOpen,
}: {
  graph: Graph;
  onOpen: (docId: string) => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const { nodes, edges } = graph;
    const positions = positionsRef.current;

    let known = 0;
    for (const node of nodes) {
      const previous = positions.get(node.id);
      if (previous) {
        node.x = previous.x;
        node.y = previous.y;
        known++;
      }
    }
    let alpha = known > nodes.length * 0.8 ? 0.3 : 1;
    let dirty = true;
    let hover = -1;
    let width = 0;
    let height = 0;
    const view = { x: 0, y: 0, k: 1 };
    let centered = false;

    const neighbors = nodes.map(() => new Set<number>());
    for (const [a, b] of edges) {
      neighbors[a].add(b);
      neighbors[b].add(a);
    }
    const labeled = new Set(
      nodes
        .map((node, index) => ({ index, degree: node.degree }))
        .filter(item => item.degree > 0)
        .sort((a, b) => b.degree - a.degree)
        .slice(0, ALWAYS_LABELED)
        .map(item => item.index)
    );

    const colors = {
      text: resolveColor(canvas, cssVarV2.text.primary, '#121212'),
      node: resolveColor(canvas, cssVarV2.text.secondary, '#7a7a7a'),
      edge: resolveColor(canvas, cssVarV2.layer.insideBorder.border, '#e3e2e4'),
      accent: resolveColor(canvas, cssVarV2.button.primary, '#1e96eb'),
    };

    const toWorld = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return {
        sx: event.clientX - rect.left,
        sy: event.clientY - rect.top,
        x: (event.clientX - rect.left - view.x) / view.k,
        y: (event.clientY - rect.top - view.y) / view.k,
      };
    };

    const hitTest = (x: number, y: number) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const radius = nodeRadius(node) + 3 / view.k;
        if ((node.x - x) ** 2 + (node.y - y) ** 2 <= radius * radius) {
          return i;
        }
      }
      return -1;
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.translate(view.x, view.y);
      context.scale(view.k, view.k);

      const focus = hover >= 0 ? neighbors[hover] : null;
      context.lineWidth = 1 / view.k;
      for (const [a, b] of edges) {
        const active = hover === a || hover === b;
        context.strokeStyle = active ? colors.accent : colors.edge;
        context.globalAlpha = focus && !active ? 0.3 : 1;
        context.beginPath();
        context.moveTo(nodes[a].x, nodes[a].y);
        context.lineTo(nodes[b].x, nodes[b].y);
        context.stroke();
      }

      context.font = `${12 / view.k}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'top';
      nodes.forEach((node, index) => {
        const related = index === hover || !!focus?.has(index);
        context.globalAlpha = focus && !related ? 0.3 : 1;
        context.fillStyle = related ? colors.accent : colors.node;
        const radius = nodeRadius(node);
        context.beginPath();
        context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        context.fill();
        if (related || view.k >= 1.5 || (!focus && labeled.has(index))) {
          context.fillStyle = colors.text;
          const title =
            node.title.length > 40 ? `${node.title.slice(0, 39)}…` : node.title;
          context.fillText(title, node.x, node.y + radius + 3 / view.k);
        }
      });
      context.globalAlpha = 1;
    };

    let frame = 0;
    const loop = () => {
      if (alpha > 0.005) {
        tick(nodes, edges, alpha);
        alpha *= 0.985;
        dirty = true;
      }
      if (dirty) {
        draw();
        dirty = false;
      }
      frame = requestAnimationFrame(loop);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (!centered && width && height) {
        view.x = width / 2;
        view.y = height / 2;
        centered = true;
      }
      dirty = true;
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    type Drag =
      | { kind: 'node'; index: number; sx: number; sy: number; moved: boolean }
      | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number };
    let drag: Drag | null = null;

    const onPointerDown = (event: PointerEvent) => {
      const point = toWorld(event);
      const index = hitTest(point.x, point.y);
      canvas.setPointerCapture(event.pointerId);
      if (index >= 0) {
        nodes[index].pinned = true;
        drag = {
          kind: 'node',
          index,
          sx: point.sx,
          sy: point.sy,
          moved: false,
        };
      } else {
        drag = {
          kind: 'pan',
          sx: point.sx,
          sy: point.sy,
          vx: view.x,
          vy: view.y,
        };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const point = toWorld(event);
      if (drag?.kind === 'node') {
        if (Math.hypot(point.sx - drag.sx, point.sy - drag.sy) > 3) {
          drag.moved = true;
        }
        if (drag.moved) {
          nodes[drag.index].x = point.x;
          nodes[drag.index].y = point.y;
          alpha = Math.max(alpha, 0.2);
        }
        dirty = true;
        return;
      }
      if (drag?.kind === 'pan') {
        view.x = drag.vx + point.sx - drag.sx;
        view.y = drag.vy + point.sy - drag.sy;
        dirty = true;
        return;
      }
      const next = hitTest(point.x, point.y);
      if (next !== hover) {
        hover = next;
        canvas.style.cursor = hover >= 0 ? 'pointer' : 'grab';
        dirty = true;
      }
    };
    const onPointerUp = () => {
      if (drag?.kind === 'node') {
        nodes[drag.index].pinned = false;
        if (!drag.moved) onOpenRef.current(nodes[drag.index].id);
      }
      drag = null;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = toWorld(event);
      const k = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, view.k * Math.exp(-event.deltaY * 0.0015))
      );
      view.x = point.sx - point.x * k;
      view.y = point.sy - point.y * k;
      view.k = k;
      dirty = true;
    };
    const onLeave = () => {
      if (hover !== -1 && !drag) {
        hover = -1;
        dirty = true;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      for (const node of nodes) {
        positions.set(node.id, { x: node.x, y: node.y });
      }
    };
  }, [graph]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      data-testid="graph-canvas"
      aria-label="Graph of linked notes"
    />
  );
};

export const GraphPage = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const docsService = useService(DocsService);
  const docs = useLiveData(docsService.list.docs$);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [showUnlinked, setShowUnlinked] = useState(false);

  useEffect(() => {
    const subscription = workspace.engine.indexer
      .search$(
        'block',
        { type: 'exists', field: 'refDocId' },
        {
          fields: ['docId', 'refDocId'],
          pagination: { limit: MAX_LINK_BLOCKS },
        }
      )
      .pipe(debounceTime(300))
      .subscribe(({ nodes }) => {
        setLinks(
          nodes.flatMap(node => {
            const from = allValues(node.fields.docId)[0];
            if (!from) return [];
            return allValues(node.fields.refDocId).map(to => ({ from, to }));
          })
        );
      });
    return () => subscription.unsubscribe();
  }, [workspace]);

  const graph = useMemo<Graph | null>(() => {
    if (!links) return null;
    const live = docs
      .filter(doc => !doc.trash$.value)
      .map(doc => ({ id: doc.id, title: doc.title$.value || 'Untitled' }));
    const linked = new Set(
      buildEdges(links, new Map(live.map((doc, i) => [doc.id, i]))).flatMap(
        edge => edge.map(index => live[index].id)
      )
    );
    const visible = showUnlinked
      ? live
      : live.filter(doc => linked.has(doc.id));
    const edges = buildEdges(
      links,
      new Map(visible.map((doc, i) => [doc.id, i]))
    );
    return { nodes: createNodes(visible, edges), edges };
  }, [docs, links, showUnlinked]);

  return (
    <>
      <ViewTitle title="Graph" />
      <ViewIcon icon="graph" />
      <ViewBody>
        <div className={styles.root}>
          <header className={styles.toolbar}>
            <span className={styles.title}>Graph</span>
            <span className={styles.meta}>
              {graph
                ? `${graph.nodes.length} ${graph.nodes.length === 1 ? 'note' : 'notes'} · ${graph.edges.length} ${graph.edges.length === 1 ? 'link' : 'links'}`
                : 'Loading links…'}
            </span>
            <span className={styles.spacer} />
            <span className={styles.meta}>
              Scroll to zoom, drag to move, click a note to open it
            </span>
            <Checkbox
              checked={showUnlinked}
              label="Show unlinked notes"
              onChange={(_, checked) => setShowUnlinked(checked)}
            />
          </header>
          {graph && graph.nodes.length === 0 ? (
            <div className={styles.empty}>
              No linked notes yet. Type @ or [[ in a note to link another note.
            </div>
          ) : graph ? (
            <GraphCanvas
              graph={graph}
              onOpen={docId => workbench.openDoc(docId, { at: 'active' })}
            />
          ) : null}
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <GraphPage />;
};
