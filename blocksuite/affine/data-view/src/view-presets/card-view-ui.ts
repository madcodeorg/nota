import type { InsertToPosition } from '@blocksuite/affine-shared/utils';
import { signal } from '@preact/signals-core';

import {
  DataViewUIBase,
  DataViewUILogicBase,
} from '../core/view/data-view-base.js';
import type { CardViewSelectionWithType } from './card-selection.js';
import type { CardSingleView } from './card-view-manager.js';

export abstract class CardViewUILogic<
  View extends CardSingleView = CardSingleView,
> extends DataViewUILogicBase<View, CardViewSelectionWithType> {
  ui$ = signal<DataViewUIBase | undefined>();

  clearSelection = () => this.setSelection();
  focusFirstCell = () =>
    this.ui$.value?.querySelector<HTMLButtonElement>('[data-row-id]')?.focus();
  showIndicator = () => false;
  hideIndicator = () => {};
  moveTo = () => {};

  openRow = (rowId: string) => {
    this.setSelection({
      viewId: this.view.id,
      type: this.view.type as 'calendar' | 'gallery',
      selectionType: 'row',
      rowId,
    });
    this.root.openDetailPanel({ view: this.view, rowId });
  };

  addRow = (position: InsertToPosition) => {
    if (this.view.readonly$.value) return;
    const rowId = this.view.rowAdd(position);
    this.openRow(rowId);
    return rowId;
  };
}
