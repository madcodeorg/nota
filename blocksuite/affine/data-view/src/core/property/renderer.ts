import type { UniComponent } from '@blocksuite/affine-shared/types';
import type { MenuConfig } from '@blocksuite/affine-components/context-menu';
import type { Property } from '../view-manager/property.js';

import { createUniComponentFromWebComponent } from '../utils/uni-component/index.js';
import type { BaseCellRenderer } from './base-cell.js';
import type { CellRenderer, DataViewCellComponent } from './manager.js';

export interface Renderer<
  Data extends NonNullable<unknown> = NonNullable<unknown>,
  RawValue = unknown,
  JsonValue = unknown,
> {
  type: string;
  icon?: UniComponent;
  cellRenderer: CellRenderer<Data, RawValue, JsonValue>;
  propertyConfig?: (property: Property) => MenuConfig[];
}

export const createFromBaseCellRenderer = <
  RawValue = unknown,
  JsonValue = unknown,
  Data extends Record<string, unknown> = Record<string, unknown>,
>(
  renderer: new () => BaseCellRenderer<RawValue, JsonValue, Data>
): DataViewCellComponent => {
  return createUniComponentFromWebComponent(renderer as never) as never;
};
