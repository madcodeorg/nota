import { useMemo } from 'react';

import { DefaultAvatarContainerStyle } from './style.css';

// Color palette for identicons — muted, professional tones
const COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
  '#d946ef', // fuchsia
];

// Background colors — darker tones that pair well
const BG_COLORS = [
  '#1e1b4b', // indigo dark
  '#2e1065', // violet dark
  '#500724', // pink dark
  '#4c0519', // rose dark
  '#431407', // orange dark
  '#422006', // yellow dark
  '#052e16', // green dark
  '#042f2e', // teal dark
  '#083344', // cyan dark
  '#172554', // blue dark
  '#3b0764', // purple dark
  '#4a044e', // fuchsia dark
];

/**
 * Simple hash function for strings -> deterministic number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate a 5x5 symmetric boolean grid from a hash.
 * Only the left half + center column are random; right mirrors left.
 */
function generateGrid(hash: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let row = 0; row < 5; row++) {
    const rowData: boolean[] = [];
    for (let col = 0; col < 3; col++) {
      // Use different bits of the hash for each cell
      const bit = (hash >> (row * 3 + col)) & 1;
      rowData.push(bit === 1);
    }
    // Mirror: col 3 = col 1, col 4 = col 0
    grid.push([rowData[0], rowData[1], rowData[2], rowData[1], rowData[0]]);
  }
  return grid;
}

export const ColorfulFallback = ({ char }: { char: string }) => {
  const svg = useMemo(() => {
    const hash = hashString(char);
    const grid = generateGrid(hash);
    const colorIndex = hash % COLORS.length;
    const fgColor = COLORS[colorIndex];
    const bgColor = BG_COLORS[colorIndex];

    const cellSize = 6;
    const padding = 5;
    const totalSize = cellSize * 5 + padding * 2;

    const rects: string[] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        if (grid[row][col]) {
          const x = padding + col * cellSize;
          const y = padding + row * cellSize;
          rects.push(
            `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${fgColor}" rx="1"/>`
          );
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}"><rect width="${totalSize}" height="${totalSize}" fill="${bgColor}"/>${rects.join('')}</svg>`;
  }, [char]);

  const dataUrl = useMemo(() => {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [svg]);

  return (
    <div className={DefaultAvatarContainerStyle}>
      <img
        src={dataUrl}
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
};

export default ColorfulFallback;
