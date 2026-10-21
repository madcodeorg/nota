import { describe, expect, test } from 'vitest';

import { buildEdges, createNodes, tick } from '../graph-layout';

describe('buildEdges', () => {
  test('dedupes links in both directions and drops unknown or self links', () => {
    const index = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(
      buildEdges(
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
          { from: 'a', to: 'a' },
          { from: 'a', to: 'missing' },
          { from: 'c', to: 'b' },
        ],
        index
      )
    ).toEqual([
      [0, 1],
      [2, 1],
    ]);
  });
});

describe('tick', () => {
  test('pulls linked notes together and pushes unlinked ones apart', () => {
    const docs = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id }));
    const edges = buildEdges(
      [{ from: 'a', to: 'b' }],
      new Map(docs.map((doc, i) => [doc.id, i]))
    );
    const nodes = createNodes(docs, edges);
    for (let i = 0; i < 300; i++) tick(nodes, edges, 1 - i / 300);
    const distance = (i: number, j: number) =>
      Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
    expect(nodes[0].degree).toBe(1);
    expect(distance(0, 1)).toBeLessThan(distance(2, 3));
    for (const node of nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
    }
  });
});
