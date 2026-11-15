import { html, svg } from 'lit';

/** Icon showing `count` side by side columns, drawn with `currentColor`. */
export function columnsIcon(count: number) {
  const gap = 1.5;
  const left = 3;
  const width = 18;
  const columnWidth = (width - gap * (count - 1)) / count;
  const columns = Array.from({ length: count }, (_, i) => {
    const x = left + i * (columnWidth + gap);
    return svg`<rect x=${x} y="4.75" width=${columnWidth} height="14.5" rx="1.25" stroke="currentColor" stroke-width="1.5" fill="none"></rect>`;
  });
  return html`<svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    ${columns}
  </svg>`;
}
