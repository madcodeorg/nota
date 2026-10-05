import { computed } from '@preact/signals-core';

import { CardSingleView } from '../card-view-manager.js';
import {
  calendarMonth,
  calendarMonthKey,
  partitionCalendarRows,
} from './date-utils.js';
import type { CalendarViewData } from './define.js';

export class CalendarSingleView extends CardSingleView<CalendarViewData> {
  get type() {
    return 'calendar';
  }

  dateProperties$ = computed(() =>
    this.propertiesRaw$.value.filter(
      property => property.type$.value === 'date'
    )
  );

  dateProperty$ = computed(() => {
    const selected = this.data$.value?.dateColumn;
    return (
      this.dateProperties$.value.find(property => property.id === selected) ??
      this.dateProperties$.value[0]
    );
  });

  month$ = computed(() => calendarMonth(this.data$.value?.month));

  calendarRows$ = computed(() => {
    const property = this.dateProperty$.value;
    return partitionCalendarRows(
      this.rows$.value,
      row => property?.cellGetOrCreate(row.rowId).value$.value
    );
  });

  dateColumnSet(id: string): void {
    if (
      this.readonly$.value ||
      !this.dateProperties$.value.some(p => p.id === id)
    )
      return;
    this.dataUpdate(() => ({ dateColumn: id }));
  }

  monthSet(date: Date): void {
    if (this.readonly$.value) return;
    this.dataUpdate(() => ({ month: calendarMonthKey(date) }));
  }
}
