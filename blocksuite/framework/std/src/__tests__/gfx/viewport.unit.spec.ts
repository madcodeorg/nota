import { describe, expect, test } from 'vitest';

import { Viewport } from '../../gfx/viewport.js';

describe('Viewport.setZoom', () => {
  test('emits a single viewportUpdated per zoom', () => {
    const viewport = new Viewport();
    const updates: number[] = [];
    viewport.viewportUpdated.subscribe(({ zoom }) => updates.push(zoom));

    viewport.setZoom(2, { x: 10, y: 10 }, true);

    expect(updates).toEqual([2]);
  });

  test('keeps the focus point fixed on screen', () => {
    const viewport = new Viewport();
    viewport.setViewport(1, [100, 100]);
    const focus = { x: 120, y: 80 };
    const before = (focus.x - viewport.centerX) * viewport.zoom;

    viewport.setZoom(3, focus, true);

    const after = (focus.x - viewport.centerX) * viewport.zoom;
    expect(after).toBeCloseTo(before);
  });

  test('clamps zoom to the allowed range', () => {
    const viewport = new Viewport();

    viewport.setZoom(1000);
    expect(viewport.zoom).toBe(viewport.ZOOM_MAX);

    viewport.setZoom(0);
    expect(viewport.zoom).toBe(viewport.ZOOM_MIN);
  });
});
