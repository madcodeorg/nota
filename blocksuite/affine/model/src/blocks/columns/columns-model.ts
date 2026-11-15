import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

import type { BlockMeta } from '../../utils/types';

export const COLUMNS_BLOCK_FLAVOUR = 'affine:columns';
export const COLUMN_BLOCK_FLAVOUR = 'affine:column';

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

export type ColumnsProps = BlockMeta;

export const ColumnsBlockSchema = defineBlockSchema({
  flavour: COLUMNS_BLOCK_FLAVOUR,
  props: (): ColumnsProps => ({
    'meta:createdAt': undefined,
    'meta:updatedAt': undefined,
    'meta:createdBy': undefined,
    'meta:updatedBy': undefined,
  }),
  metadata: {
    version: 1,
    role: 'hub',
    parent: ['affine:note'],
    children: [COLUMN_BLOCK_FLAVOUR],
  },
  toModel: () => new ColumnsBlockModel(),
});

export class ColumnsBlockModel extends BlockModel<ColumnsProps> {}

export const ColumnsBlockSchemaExtension =
  BlockSchemaExtension(ColumnsBlockSchema);

export type ColumnProps = {
  /**
   * Relative width of the column. Columns of one layout share the row
   * proportionally to their ratios, so the values do not need to sum to 1.
   */
  ratio: number;
} & BlockMeta;

export const ColumnBlockSchema = defineBlockSchema({
  flavour: COLUMN_BLOCK_FLAVOUR,
  props: (): ColumnProps => ({
    ratio: 1,
    'meta:createdAt': undefined,
    'meta:updatedAt': undefined,
    'meta:createdBy': undefined,
    'meta:updatedBy': undefined,
  }),
  metadata: {
    version: 1,
    role: 'hub',
    parent: [COLUMNS_BLOCK_FLAVOUR],
    children: ['@content', 'affine:callout'],
  },
  toModel: () => new ColumnBlockModel(),
});

export class ColumnBlockModel extends BlockModel<ColumnProps> {}

export const ColumnBlockSchemaExtension =
  BlockSchemaExtension(ColumnBlockSchema);
