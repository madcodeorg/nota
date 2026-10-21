export interface GraphNode {
  id: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  pinned: boolean;
}

export type GraphEdge = [source: number, target: number];

const REPULSION = 1800;
const LINK_DISTANCE = 70;
const SPRING = 0.04;
const GRAVITY = 0.012;
const DAMPING = 0.82;

/** Unique, undirected links between known docs. */
export function buildEdges(
  links: { from: string; to: string }[],
  nodeIndex: Map<string, number>
): GraphEdge[] {
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const { from, to } of links) {
    const a = nodeIndex.get(from);
    const b = nodeIndex.get(to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return edges;
}

export function createNodes(
  docs: { id: string; title: string }[],
  edges: GraphEdge[]
): GraphNode[] {
  // Golden-angle spiral gives a deterministic, evenly spread start.
  const nodes = docs.map((doc, index) => {
    const radius = 12 * Math.sqrt(index + 1);
    const angle = index * 2.399963;
    return {
      id: doc.id,
      title: doc.title,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      degree: 0,
      pinned: false,
    };
  });
  for (const [a, b] of edges) {
    nodes[a].degree++;
    nodes[b].degree++;
  }
  return nodes;
}

/** One step of a small force simulation: repulsion, springs and gravity. */
export function tick(nodes: GraphNode[], edges: GraphEdge[], alpha: number) {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance2 = dx * dx + dy * dy;
      if (distance2 < 1) {
        dx = (i - j) * 0.1 || 0.1;
        dy = 0.1;
        distance2 = 1;
      }
      const force = (REPULSION * alpha) / distance2;
      const distance = Math.sqrt(distance2);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  for (const [ai, bi] of edges) {
    const a = nodes[ai];
    const b = nodes[bi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (distance - LINK_DISTANCE) * SPRING * alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }
  for (const node of nodes) {
    node.vx = (node.vx - node.x * GRAVITY * alpha) * DAMPING;
    node.vy = (node.vy - node.y * GRAVITY * alpha) * DAMPING;
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.x += node.vx;
    node.y += node.vy;
  }
}

export function nodeRadius(node: GraphNode) {
  return 4 + Math.min(10, Math.sqrt(node.degree) * 2);
}
