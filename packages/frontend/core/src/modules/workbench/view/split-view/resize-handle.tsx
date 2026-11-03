import { useDropTarget } from '@nota/component';
import type { AffineDNDData } from '@nota/core/types/dnd';
import { useLiveData, useService } from '@nota/infra';
import { useAtomValue } from 'jotai';
import type { HTMLAttributes } from 'react';
import { useCallback } from 'react';

import type { View } from '../../entities/view';
import { WorkbenchService } from '../../services/workbench';
import * as styles from './split-view.css';
import { draggingOverResizeHandleAtom } from './state';
import { allowedSplitViewEntityTypes } from './types';

interface ResizeHandleProps extends HTMLAttributes<HTMLDivElement> {
  state: 'resizing' | 'drop-indicator' | 'idle';
  edge: 'left' | 'right';
  view: View;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  onResizing?: (offset: { x: number; y: number }) => void;
}
export const ResizeHandle = ({
  state,
  view,
  edge,
  onResizing,
  onResizeStart,
  onResizeEnd,
}: ResizeHandleProps) => {
  const workbench = useService(WorkbenchService).workbench;
  const views = useLiveData(workbench.views$);

  const draggingOverHandle = useAtomValue(draggingOverResizeHandleAtom);

  const draggingOver =
    draggingOverHandle?.edge === edge && draggingOverHandle.viewId === view.id;

  const index = views.findIndex(v => v.id === view.id);

  const isLast = index === views.length - 1;
  const isFirst = index === 0;

  const { dropTargetRef } = useDropTarget<AffineDNDData>(() => {
    return {
      data: {
        at: 'workbench:resize-handle',
        edge,
        viewId: view.id,
      },
      canDrop: data => {
        return (
          (!!data.source.data.entity?.type &&
            allowedSplitViewEntityTypes.has(data.source.data.entity?.type)) ||
          data.source.data.from?.at === 'workbench:link'
        );
      },
    };
  }, [edge, view.id]);

  const canResize =
    state !== 'drop-indicator' &&
    !(isLast && edge === 'right') &&
    !(isFirst && edge === 'left');

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canResize || !onResizing || !onResizeStart || !onResizeEnd) {
        return;
      }
      if (e.button !== 0) return;

      e.preventDefault();
      onResizeStart();

      let latest = { x: e.clientX, y: e.clientY };
      let frame = 0;
      const flush = () => {
        frame = 0;
        onResizing(latest);
      };
      const listeners = new AbortController();
      const onPointerMove = (e: PointerEvent) => {
        latest = { x: e.clientX, y: e.clientY };
        if (!frame) frame = requestAnimationFrame(flush);
      };
      const onEnd = () => {
        if (frame) {
          cancelAnimationFrame(frame);
          flush();
        }
        listeners.abort();
        onResizeEnd();
      };

      const { signal } = listeners;
      window.addEventListener('pointermove', onPointerMove, { signal });
      window.addEventListener('pointerup', onEnd, { signal });
      window.addEventListener('pointercancel', onEnd, { signal });
      window.addEventListener('blur', onEnd, { signal });
    },
    [canResize, onResizeEnd, onResizeStart, onResizing]
  );

  const onDoubleClick = useCallback(() => {
    if (canResize && onResizing) workbench.equalizeSizes();
  }, [canResize, onResizing, workbench]);

  return (
    <div
      ref={dropTargetRef}
      data-edge={edge}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      data-is-last={isLast}
      data-is-first={isFirst}
      data-state={state}
      data-dragging-over={state === 'drop-indicator' ? draggingOver : false}
      data-can-resize={canResize}
      className={styles.resizeHandle}
    />
  );
};
