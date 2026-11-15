type Rect = { x: number; y: number; width: number; height: number };

/** A window of `size`, clamped to `area` and centered in it. */
export function centeredBounds(
  area: Rect,
  size: { width: number; height: number }
): Rect {
  const width = Math.min(area.width, size.width);
  const height = Math.min(area.height, size.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
