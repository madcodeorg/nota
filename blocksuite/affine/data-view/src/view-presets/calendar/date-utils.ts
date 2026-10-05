/** Date cells contain epoch milliseconds. Use local calendar days, like Date cells. */
export function calendarDayKey(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarMonth(value: unknown, fallback = new Date()): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (
      year != null &&
      year >= 100 &&
      month != null &&
      month >= 1 &&
      month <= 12
    ) {
      return new Date(year, month - 1, 1);
    }
  }
  return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
}

export function calendarMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Six Monday-first weeks, advanced by local dates to avoid DST arithmetic. */
export function calendarMonthDays(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from(
    { length: 42 },
    (_, offset) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
  );
}

export function partitionCalendarRows<Row>(
  rows: Row[],
  dateGet: (row: Row) => unknown
): { days: Map<string, Row[]>; undated: Row[] } {
  const days = new Map<string, Row[]>();
  const undated: Row[] = [];
  for (const row of rows) {
    const key = calendarDayKey(dateGet(row));
    if (!key) undated.push(row);
    else {
      const entries = days.get(key) ?? [];
      entries.push(row);
      days.set(key, entries);
    }
  }
  return { days, undated };
}
