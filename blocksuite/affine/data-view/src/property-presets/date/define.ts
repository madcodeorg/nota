import { format } from 'date-fns/format';
import zod from 'zod';

import { t } from '../../core/logical/type-presets.js';
import { propertyType } from '../../core/property/property-config.js';

export type DateRangeValue = {
  start: number;
  end?: number;
  includeTime?: boolean;
};

export type DatePropertyValue = number | DateRangeValue | null;

export const DateRangeValueSchema = zod.object({
  start: zod.number().finite(),
  end: zod.number().finite().optional(),
  includeTime: zod.boolean().optional(),
});

export const DatePropertyValueSchema = zod.union([
  zod.number().finite(),
  DateRangeValueSchema,
  zod.null(),
]);

const isValidTimestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  !Number.isNaN(new Date(value).getTime());

export const normalizeDateValue = (value: unknown): DatePropertyValue => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return isValidTimestamp(value) ? value : null;
  }

  if (typeof value === 'object') {
    const candidate = value as {
      start?: unknown;
      end?: unknown;
      includeTime?: unknown;
    };
    if (!isValidTimestamp(candidate.start)) {
      return null;
    }

    const includeTime = candidate.includeTime === true;
    const rawEnd = isValidTimestamp(candidate.end) ? candidate.end : undefined;

    if (rawEnd == null && !includeTime) {
      return candidate.start;
    }

    let start = candidate.start;
    let end = rawEnd;
    if (end != null && end < start) {
      [start, end] = [end, start];
    }

    return {
      start,
      ...(end != null ? { end } : {}),
      ...(includeTime ? { includeTime: true } : {}),
    };
  }

  return null;
};

export const getDateStart = (value: unknown): number | null => {
  const normalized = normalizeDateValue(value);
  if (normalized == null) {
    return null;
  }
  return typeof normalized === 'number' ? normalized : normalized.start;
};

export const getDateEnd = (value: unknown): number | null => {
  const normalized = normalizeDateValue(value);
  if (normalized == null || typeof normalized === 'number') {
    return null;
  }
  return normalized.end ?? null;
};

export const formatDatePropertyValue = (
  value: unknown,
  dateFormat = 'yyyy-MM-dd'
): string => {
  const normalized = normalizeDateValue(value);
  if (normalized == null) {
    return '';
  }

  if (typeof normalized === 'number') {
    return format(normalized, dateFormat);
  }

  const pattern = normalized.includeTime ? `${dateFormat} HH:mm` : dateFormat;
  const startText = format(normalized.start, pattern);
  if (normalized.end != null) {
    const endText = format(normalized.end, pattern);
    return `${startText} → ${endText}`;
  }
  return startText;
};

const CANONICAL_DATE_TIME_RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const RANGE_SEPARATOR_RE = /\s*(?:→|->)\s*|\s+–\s+|\s+to\s+/i;

const parseSingleDatePart = (
  raw: string
): { timestamp: number; hasTime: boolean } | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const match = CANONICAL_DATE_TIME_RE.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hasTime = match[4] != null && match[5] != null;
    const hour = hasTime ? Number(match[4]) : 0;
    const minute = hasTime ? Number(match[5]) : 0;
    const second = match[6] != null ? Number(match[6]) : 0;

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return null;
    }

    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return {
      timestamp: date.getTime(),
      hasTime,
    };
  }

  // Reject purely numeric strings so arbitrary integers aren't misinterpreted as dates.
  if (/^\d+$/.test(trimmed)) {
    return null;
  }

  // Reject clearly invalid yyyy-mm-dd-like inputs before falling back to Date.parse.
  if (
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(
      trimmed
    )
  ) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return null;
  }

  return {
    timestamp: parsed,
    hasTime: /\d{1,2}:\d{2}/.test(trimmed),
  };
};

export const parseDatePropertyString = (value: string): DatePropertyValue => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(RANGE_SEPARATOR_RE);
  if (parts.length === 1) {
    const startPart = parseSingleDatePart(parts[0] ?? '');
    if (!startPart) {
      return null;
    }
    return normalizeDateValue(
      startPart.hasTime
        ? { start: startPart.timestamp, includeTime: true }
        : startPart.timestamp
    );
  }

  if (parts.length === 2) {
    const startPart = parseSingleDatePart(parts[0] ?? '');
    const endPart = parseSingleDatePart(parts[1] ?? '');
    if (!startPart || !endPart) {
      return null;
    }
    const includeTime = startPart.hasTime || endPart.hasTime;
    return normalizeDateValue({
      start: startPart.timestamp,
      end: endPart.timestamp,
      ...(includeTime ? { includeTime: true } : {}),
    });
  }

  return null;
};

export const datePropertyType = propertyType('date');

export const datePropertyModelConfig = datePropertyType.modelConfig({
  name: 'Date',
  propertyData: {
    schema: zod.object({}),
    default: () => ({}),
  },
  jsonValue: {
    schema: zod.number().nullable(),
    isEmpty: ({ value }) => value == null,
    type: () => t.date.instance(),
  },
  rawValue: {
    schema: DatePropertyValueSchema,
    default: () => null,
    toString: ({ value }) => formatDatePropertyValue(value),
    fromString: ({ value }) => ({
      value: parseDatePropertyString(value),
    }),
    toJson: ({ value }) => getDateStart(value),
    fromJson: ({ value }) => normalizeDateValue(value),
    setValue: ({ newValue, setValue }) => {
      setValue(normalizeDateValue(newValue));
    },
  },
});
