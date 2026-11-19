import { computed } from '@preact/signals-core';

import { CardSingleView } from '../card-view-manager.js';
import {
  type CalendarDateValue,
  calendarDayKey,
  calendarMonth,
  calendarMonthKey,
  calendarWeekStart,
  moveCalendarDateValue,
  partitionCalendarRows,
} from './date-utils.js';
import type { CalendarViewData, CalendarViewScope } from './define.js';

function isSameCalendarDateValue(
  current: unknown,
  next: CalendarDateValue
): boolean {
  if (typeof next === 'number') return current === next;
  if (
    typeof current !== 'object' ||
    current === null ||
    Array.isArray(current)
  ) {
    return false;
  }
  const value = current as Record<string, unknown>;
  return (
    value.start === next.start &&
    value.end === next.end &&
    value.includeTime === next.includeTime
  );
}

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

  modeScope$ = computed<CalendarViewScope>(() =>
    this.data$.value?.modeScope === 'week' ? 'week' : 'month'
  );

  weekStart$ = computed(() => {
    const saved = this.data$.value?.weekStart;
    if (saved) return calendarWeekStart(saved, this.month$.value);
    const today = new Date();
    const month = this.month$.value;
    const isCurrentMonth =
      month.getFullYear() === today.getFullYear() &&
      month.getMonth() === today.getMonth();
    return calendarWeekStart(undefined, isCurrentMonth ? today : month);
  });

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

  modeScopeSet(scope: CalendarViewScope): void {
    if (this.readonly$.value) return;
    if (scope !== 'month' && scope !== 'week') return;
    this.dataUpdate(() => ({ modeScope: scope }));
  }

  weekStartSet(date: Date): void {
    if (this.readonly$.value) return;
    const start = calendarWeekStart(date);
    const key = calendarDayKey(start.getTime());
    if (!key) return;
    this.dataUpdate(() => ({
      weekStart: key,
      month: calendarMonthKey(date),
    }));
  }

  moveRowToDate(rowId: string, targetDate: Date): void {
    if (this.readonly$.value) return;
    const property = this.dateProperty$.value;
    if (!property) return;
    if (!this.rows$.value.some(row => row.rowId === rowId)) return;
    const currentValue = property.valueGet(rowId);
    const nextValue = moveCalendarDateValue(currentValue, targetDate);
    if (isSameCalendarDateValue(currentValue, nextValue)) return;
    property.valueSet(rowId, nextValue);
  }
}
