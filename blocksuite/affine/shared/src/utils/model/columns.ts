import {
  COLUMN_BLOCK_FLAVOUR,
  type ColumnBlockModel,
  COLUMNS_BLOCK_FLAVOUR,
  type ColumnsBlockModel,
  MAX_COLUMNS,
  MIN_COLUMNS,
} from '@blocksuite/affine-model';
import type { BlockModel, Store } from '@blocksuite/store';

export function isColumnsModel(
  model: BlockModel | null | undefined
): model is ColumnsBlockModel {
  return model?.flavour === COLUMNS_BLOCK_FLAVOUR;
}

export function isColumnModel(
  model: BlockModel | null | undefined
): model is ColumnBlockModel {
  return model?.flavour === COLUMN_BLOCK_FLAVOUR;
}

/**
 * Returns the closest column that contains the block, or the block itself
 * when it is a column.
 */
export function getClosestColumn(
  model: BlockModel | null | undefined
): ColumnBlockModel | null {
  let current: BlockModel | null | undefined = model;
  while (current) {
    if (isColumnModel(current)) return current;
    current = current.parent;
  }
  return null;
}

function addColumn(store: Store, columns: BlockModel | string) {
  const columnId = store.addBlock(COLUMN_BLOCK_FLAVOUR, { ratio: 1 }, columns);
  const paragraphId = store.addBlock('affine:paragraph', {}, columnId);
  return { columnId, paragraphId };
}

/**
 * Insert a columns layout with `count` empty columns (each holding one empty
 * paragraph) into `parent` at `index`.
 */
export function insertColumns(
  store: Store,
  parent: BlockModel | string,
  index: number | undefined,
  count: number
) {
  const columnCount = Math.min(
    MAX_COLUMNS,
    Math.max(MIN_COLUMNS, Math.floor(count))
  );
  let columnsId = '';
  const paragraphIds: string[] = [];
  store.transact(() => {
    columnsId = store.addBlock(COLUMNS_BLOCK_FLAVOUR, {}, parent, index);
    for (let i = 0; i < columnCount; i++) {
      paragraphIds.push(addColumn(store, columnsId).paragraphId);
    }
  });
  return { columnsId, paragraphIds };
}

/**
 * Append an empty column. Returns the new paragraph id, or null when the
 * layout already has the maximum number of columns.
 */
export function appendColumn(store: Store, columns: ColumnsBlockModel) {
  if (columns.children.length >= MAX_COLUMNS) return null;
  let paragraphId: string | null = null;
  store.transact(() => {
    paragraphId = addColumn(store, columns).paragraphId;
  });
  return paragraphId;
}

function moveOutAndDelete(
  store: Store,
  columns: ColumnsBlockModel,
  columnList: BlockModel[]
) {
  const parent = store.getParent(columns);
  if (!parent) return [];
  // move column by column: each group lands right before the layout, which
  // keeps the reading order (moving blocks of several parents at once does not)
  const groups = columnList.map(column => [...column.children]);
  for (const blocks of groups) {
    if (blocks.length > 0) store.moveBlocks(blocks, parent, columns, true);
  }
  store.deleteBlock(columns);
  return groups.flat().map(block => block.id);
}

/**
 * Replace the layout with its content: the blocks of every column are moved
 * out in reading order (column by column) and the layout is removed.
 * Returns the ids of the moved blocks.
 */
export function unwrapColumns(store: Store, columns: ColumnsBlockModel) {
  let ids: string[] = [];
  store.transact(() => {
    ids = moveOutAndDelete(store, columns, columns.children);
  });
  return ids;
}

/**
 * Remove a column together with its content. When fewer than two columns are
 * left, the layout is unwrapped so no single-column layout remains.
 */
export function removeColumn(store: Store, column: ColumnBlockModel) {
  const columns = store.getParent(column);
  if (!isColumnsModel(columns)) return;
  const remaining = columns.children.filter(child => child !== column);
  store.transact(() => {
    store.deleteBlock(column);
    if (remaining.length < MIN_COLUMNS) {
      moveOutAndDelete(store, columns, remaining);
    }
  });
}

/**
 * Compute the ratios of two neighbouring columns after their shared edge was
 * dragged by `delta` pixels. The sum of both ratios is preserved, and neither
 * column gets narrower than `minWidth` pixels.
 */
export function resizeColumnPair(
  ratios: [number, number],
  widths: [number, number],
  delta: number,
  minWidth: number
): [number, number] {
  const totalRatio = ratios[0] + ratios[1];
  const totalWidth = widths[0] + widths[1];
  if (totalWidth <= 0 || totalRatio <= 0) return ratios;
  const min = Math.min(minWidth, totalWidth / 2);
  const left = Math.min(Math.max(widths[0] + delta, min), totalWidth - min);
  const leftRatio = roundRatio((left / totalWidth) * totalRatio);
  return [leftRatio, roundRatio(totalRatio - leftRatio)];
}

function roundRatio(value: number) {
  return Math.round(value * 1000) / 1000;
}
