import {
  insertPositionToIndex,
  type InsertToPosition,
} from '@blocksuite/affine-shared/utils';
import { computed } from '@preact/signals-core';

import { evalFilter } from '../core/filter/eval.js';
import { generateDefaultValues } from '../core/filter/generate-default-values.js';
import { FilterTrait, filterTraitKey } from '../core/filter/trait.js';
import type { FilterGroup } from '../core/filter/types.js';
import { emptyFilterGroup } from '../core/filter/utils.js';
import { SortManager, sortTraitKey } from '../core/sort/manager.js';
import type { Sort } from '../core/sort/types.js';
import type { BasicViewDataType } from '../core/view/data-view.js';
import { PropertyBase } from '../core/view-manager/property.js';
import type { Row } from '../core/view-manager/row.js';
import { SingleViewBase } from '../core/view-manager/single-view.js';

export type CardViewColumn = { id: string; hide?: boolean };
export type CardViewData = BasicViewDataType & {
  columns: CardViewColumn[];
  filter: FilterGroup;
  sort?: Sort;
  header: { titleColumn?: string; imageColumn?: string };
};

/** Calendar and Gallery share the same canonical rows and property controls. */
export abstract class CardSingleView<
  Data extends CardViewData = CardViewData,
> extends SingleViewBase<Data> {
  propertiesRaw$ = computed(() => {
    const remaining = new Set(this.dataSource.properties$.value);
    const ids: string[] = [];
    for (const column of this.data$.value?.columns ?? []) {
      if (remaining.delete(column.id)) ids.push(column.id);
    }
    return [...ids, ...remaining].map(id => this.propertyGetOrCreate(id));
  });

  properties$ = computed(() =>
    this.propertiesRaw$.value.filter(property => !property.hide$.value)
  );

  detailProperties$ = computed(() =>
    this.propertiesRaw$.value.filter(
      property => property.type$.value !== 'title'
    )
  );

  mainProperties$ = computed(() => ({
    ...this.data$.value?.header,
    titleColumn: this.propertiesRaw$.value.find(
      property => property.type$.value === 'title'
    )?.id,
  }));

  readonly$ = computed(() => this.manager.readonly$.value);
  filter$ = computed(() => this.data$.value?.filter ?? emptyFilterGroup);
  filterTrait = this.traitSet(
    filterTraitKey,
    new FilterTrait(this.filter$, this, {
      filterSet: filter => this.dataUpdate(() => ({ filter }) as Partial<Data>),
    })
  );

  sortManager = this.traitSet(
    sortTraitKey,
    new SortManager(
      computed(() => this.data$.value?.sort),
      this,
      {
        setSortList: sort => this.dataUpdate(() => ({ sort }) as Partial<Data>),
      }
    )
  );

  propertyGetOrCreate(id: string): CardProperty {
    return new CardProperty(this, id);
  }

  isShow(rowId: string): boolean {
    return evalFilter(
      this.filter$.value,
      Object.fromEntries(
        this.propertiesRaw$.value.map(property => [
          property.id,
          property.cellGetOrCreate(rowId).jsonValue$.value,
        ])
      )
    );
  }

  protected override rowsMapping(rows: Row[]): Row[] {
    return this.sortManager.sort(super.rowsMapping(rows));
  }

  override rowAdd(position: InsertToPosition | number): string {
    const id = super.rowAdd(position);
    const values = generateDefaultValues(this.filter$.value, this.vars$.value);
    for (const [propertyId, value] of Object.entries(values)) {
      this.cellGetOrCreate(id, propertyId).jsonValueSet(value);
    }
    return id;
  }

  titleGet(rowId: string): string {
    const title = this.mainProperties$.value.titleColumn;
    return (
      (title ? this.cellGetOrCreate(rowId, title).stringValue$.value : '') ||
      'Untitled'
    );
  }

  columnsUpdate(
    updater: (columns: CardViewColumn[]) => CardViewColumn[]
  ): void {
    // Include newly added properties even before they have per-view options.
    this.dataUpdate(
      () =>
        ({
          columns: updater(
            this.propertiesRaw$.value.map(property => ({
              id: property.id,
              hide: property.hide$.value,
            }))
          ),
        }) as Partial<Data>
    );
  }
}

export class CardProperty extends PropertyBase {
  hide$ = computed(() => {
    if (this.type$.value === 'title') return false;
    return (
      this.cardView.data$.value?.columns.find(column => column.id === this.id)
        ?.hide ?? !(this.meta$.value?.config.fixed?.defaultShow ?? true)
    );
  });

  constructor(
    private readonly cardView: CardSingleView,
    id: string
  ) {
    super(cardView, id);
  }

  override hideSet(hide: boolean): void {
    if (this.cardView.readonly$.value || !this.hideCanSet) return;
    this.cardView.columnsUpdate(columns =>
      columns.map(column =>
        column.id === this.id ? { ...column, hide } : column
      )
    );
  }

  override move(position: InsertToPosition): void {
    if (this.cardView.readonly$.value) return;
    this.cardView.columnsUpdate(columns => {
      const index = columns.findIndex(column => column.id === this.id);
      const [column] = columns.splice(index, 1);
      if (column)
        columns.splice(insertPositionToIndex(position, columns), 0, column);
      return columns;
    });
  }
}
