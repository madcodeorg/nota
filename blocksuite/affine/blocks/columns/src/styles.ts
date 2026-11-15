import { unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import { css } from 'lit';

export const COLUMN_GAP = 24;
export const MIN_COLUMN_WIDTH = 80;
const STACK_BELOW_WIDTH = 480;

export const columnsBlockStyles = css`
  affine-columns {
    display: block;
    margin: 8px 0;
    container-type: inline-size;
  }

  .affine-columns-container {
    display: flex;
    gap: ${COLUMN_GAP}px;
    align-items: stretch;
  }

  @container (max-width: ${STACK_BELOW_WIDTH}px) {
    .affine-columns-container {
      flex-direction: column;
      gap: 0;
    }

    .affine-columns-container .affine-column-resizer {
      display: none;
    }
  }
`;

export const columnBlockStyles = css`
  affine-column {
    display: block;
    position: relative;
    flex: 1 1 0;
    min-width: 0;
  }

  .affine-column-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -${COLUMN_GAP / 2 + 4}px;
    width: 8px;
    z-index: 1;
    cursor: col-resize;
    user-select: none;
    touch-action: none;
  }

  .affine-column-resizer::after {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 3px;
    width: 2px;
    border-radius: 1px;
    background: transparent;
    transition: background 0.15s ease;
  }

  .affine-column-resizer:hover::after,
  .affine-column-resizer[data-resizing='true']::after {
    background: var(--nota-accent, ${unsafeCSSVarV2('button/primary')});
  }

  affine-column:last-child .affine-column-resizer {
    display: none;
  }

  .affine-column-placeholder {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    min-height: 32px;
    margin: 4px 0;
    padding: 2px 4px 2px 8px;
    border: 1px dashed ${unsafeCSSVarV2('layer/insideBorder/border')};
    border-radius: 4px;
    color: ${unsafeCSSVarV2('text/placeholder')};
    font-size: var(--affine-font-sm);
    cursor: text;
    user-select: none;
  }

  .affine-column-placeholder-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: ${unsafeCSSVarV2('icon/secondary')};
    cursor: pointer;
  }

  .affine-column-placeholder-remove:hover {
    background: ${unsafeCSSVarV2('layer/background/hoverOverlay')};
    color: ${unsafeCSSVarV2('status/error')};
  }

  .affine-column-placeholder-remove svg {
    width: 16px;
    height: 16px;
  }
`;
