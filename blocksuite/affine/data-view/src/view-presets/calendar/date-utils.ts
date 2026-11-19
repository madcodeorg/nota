const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_CALENDAR_RANGE_DAYS = 366;

export type CalendarDateRangeValue = {
  start: number;
  end?: number;
  includeTime?: boolean;
};

export type CalendarDateValue = number | CalendarDateRangeValue;

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isCalendarDateRange(value: unknown): value is CalendarDateRangeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'start' in value &&
    isValidTimestamp((value as CalendarDateRangeValue).start)
  );
}

function formatLocalDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMondayWeek(date: Date): Date {
  const local = localDateOnly(date);
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  return localDateOnly(local);
}

function localCalendarDayDiff(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

function withLocalTimeOf(targetDate: Date, sourceDate: Date): number {
  return new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    sourceDate.getHours(),
    sourceDate.getMinutes(),
    sourceDate.getSeconds(),
    sourceDate.getMilliseconds()
  ).getTime();
}

function shiftLocalCalendarDays(sourceDate: Date, dayDelta: number): number {
  return new Date(
    sourceDate.getFullYear(),
    sourceDate.getMonth(),
    sourceDate.getDate() + dayDelta,
    sourceDate.getHours(),
    sourceDate.getMinutes(),
    sourceDate.getSeconds(),
    sourceDate.getMilliseconds()
  ).getTime();
}

/**
 * Date cells contain either legacy epoch milliseconds or a `{ start, end?, includeTime? }` range object.
 * Use local calendar days, like Date cells.
 */
export function calendarDayKey(value: unknown): string | undefined {
  if (isValidTimestamp(value)) return formatLocalDayKey(new Date(value));
  if (isCalendarDateRange(value))
    return formatLocalDayKey(new Date(value.start));
  return;
}

/**
 * Returns every local `yyyy-MM-dd` day key spanned by a date value (inclusive).
 * Reversed ranges (`end < start`) gracefully fall back to the start day; spans cap at 366 days.
 */
export function calendarDayKeys(value: unknown): string[] {
  if (isValidTimestamp(value)) return [formatLocalDayKey(new Date(value))];
  if (!isCalendarDateRange(value)) return [];
  const startDate = localDateOnly(new Date(value.start));
  const rawEndDate = isValidTimestamp(value.end)
    ? localDateOnly(new Date(value.end))
    : startDate;
  const endDate =
    rawEndDate.getTime() < startDate.getTime() ? startDate : rawEndDate;
  const keys: string[] = [];
  for (let offset = 0; offset < MAX_CALENDAR_RANGE_DAYS; offset++) {
    const current = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + offset
    );
    if (
      Number.isNaN(current.getTime()) ||
      current.getTime() > endDate.getTime()
    )
      break;
    keys.push(formatLocalDayKey(current));
  }
  return keys;
}

/** Returns a local `HH:mm` time badge when a range date explicitly includes time. */
export function calendarTimeBadge(value: unknown): string | undefined {
  if (!isCalendarDateRange(value) || !value.includeTime) return;
  const date = new Date(value.start);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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
  const start = startOfMondayWeek(
    new Date(month.getFullYear(), month.getMonth(), 1)
  );
  return Array.from(
    { length: 42 },
    (_, offset) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
  );
}

/** Parses a persisted `yyyy-MM-dd` week anchor (or Date) and snaps to Monday 00:00 local time. */
export function calendarWeekStart(value: unknown, fallback = new Date()): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    if (
      year != null &&
      year >= 100 &&
      month != null &&
      month >= 1 &&
      month <= 12 &&
      day != null &&
      day >= 1 &&
      day <= 31
    ) {
      const parsed = new Date(year, month - 1, day);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month - 1 &&
        parsed.getDate() === day
      ) {
        return startOfMondayWeek(parsed);
      }
    }
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return startOfMondayWeek(value);
  }
  return startOfMondayWeek(fallback);
}

/** Seven Monday-first local calendar days, advanced by local date arithmetic to avoid DST drift. */
export function calendarWeekDays(anchor: Date): Date[] {
  const start = startOfMondayWeek(anchor);
  return Array.from(
    { length: 7 },
    (_, offset) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
  );
}

/**
 * Reschedules a calendar row date value onto `targetDate` (local day).
 * Preserves legacy plain-number vs range-object shape, local time-of-day, duration, and `includeTime`.
 */
export function moveCalendarDateValue(
  currentValue: unknown,
  targetDate: Date
): CalendarDateValue {
  const targetDay = localDateOnly(targetDate);
  if (isValidTimestamp(currentValue)) {
    return withLocalTimeOf(targetDay, new Date(currentValue));
  }
  if (isCalendarDateRange(currentValue)) {
    const startSource = new Date(currentValue.start);
    const next: CalendarDateRangeValue = {
      start: withLocalTimeOf(targetDay, startSource),
    };
    if (isValidTimestamp(currentValue.end)) {
      const dayDelta = localCalendarDayDiff(startSource, targetDay);
      next.end = shiftLocalCalendarDays(new Date(currentValue.end), dayDelta);
    }
    if (currentValue.includeTime !== undefined) {
      next.includeTime = currentValue.includeTime;
    }
    return next;
  }
  return targetDay.getTime();
}

export function partitionCalendarRows<Row>(
  rows: Row[],
  dateGet: (row: Row) => unknown
): { days: Map<string, Row[]>; undated: Row[] } {
  const days = new Map<string, Row[]>();
  const undated: Row[] = [];
  for (const row of rows) {
    const keys = calendarDayKeys(dateGet(row));
    if (keys.length === 0) undated.push(row);
    else {
      for (const key of keys) {
        const entries = days.get(key) ?? [];
        entries.push(row);
        days.set(key, entries);
      }
    }
  }
  return { days, undated };
}
