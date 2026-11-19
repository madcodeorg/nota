/** @vitest-environment happy-dom */
import { afterEach, describe, expect, test } from 'vitest';

import { DateCellPopover } from '../property-presets/date/cell-renderer.js';
import { propertyPresetsEffects } from '../property-presets/effect.js';
import {
  type DatePropertyValue,
  type DateRangeValue,
  formatDatePropertyValue,
  getDateEnd,
  getDateStart,
  normalizeDateValue,
  parseDatePropertyString,
} from '../property-presets/index.js';
import { datePropertyModelConfig } from '../property-presets/pure-index.js';

let effectsRegistered = false;
const ensureEffects = () => {
  if (!effectsRegistered) {
    propertyPresetsEffects();
    effectsRegistered = true;
  }
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('Date property backward compatibility, ranges, and time', () => {
  const day1 = new Date(2026, 3, 19, 0, 0, 0, 0).getTime();
  const day2 = new Date(2026, 3, 22, 0, 0, 0, 0).getTime();
  const day1Timed = new Date(2026, 3, 19, 9, 30, 0, 0).getTime();
  const day2Timed = new Date(2026, 3, 22, 17, 45, 0, 0).getTime();

  test('normalizes plain numbers, null, ranges, and includeTime while preserving legacy storage', () => {
    expect(normalizeDateValue(null)).toBeNull();
    expect(normalizeDateValue(undefined)).toBeNull();
    expect(normalizeDateValue(Number.NaN)).toBeNull();
    expect(normalizeDateValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeDateValue(1e20)).toBeNull();
    expect(normalizeDateValue({ start: Number.NaN })).toBeNull();

    // Plain number stays plain number
    expect(normalizeDateValue(day1)).toBe(day1);
    // Object without end and falsy includeTime collapses back to plain number
    expect(normalizeDateValue({ start: day1 })).toBe(day1);
    expect(normalizeDateValue({ start: day1, includeTime: false })).toBe(day1);

    // Date range without time
    const range: DateRangeValue = { start: day1, end: day2 };
    expect(normalizeDateValue(range)).toEqual({ start: day1, end: day2 });
    expect(
      normalizeDateValue({ start: day1, end: day2, includeTime: false })
    ).toEqual({ start: day1, end: day2 });

    // Single date with time
    expect(normalizeDateValue({ start: day1Timed, includeTime: true })).toEqual(
      { start: day1Timed, includeTime: true }
    );

    // Date range with time
    expect(
      normalizeDateValue({
        start: day1Timed,
        end: day2Timed,
        includeTime: true,
      })
    ).toEqual({
      start: day1Timed,
      end: day2Timed,
      includeTime: true,
    });
  });

  test('normalizes end < start so end >= start is always guaranteed', () => {
    const normalizedRange = normalizeDateValue({ start: day2, end: day1 });
    expect(normalizedRange).toEqual({ start: day1, end: day2 });
    expect(getDateStart(normalizedRange)).toBe(day1);
    expect(getDateEnd(normalizedRange)).toBe(day2);

    const normalizedTimed = normalizeDateValue({
      start: day2Timed,
      end: day1Timed,
      includeTime: true,
    });
    expect(normalizedTimed).toEqual({
      start: day1Timed,
      end: day2Timed,
      includeTime: true,
    });
  });

  test('getDateStart, getDateEnd, and rawValue.toJson preserve t.date compatibility', () => {
    const dataSource = {} as any;
    const cases: Array<[DatePropertyValue, number | null, number | null]> = [
      [null, null, null],
      [day1, day1, null],
      [{ start: day1, end: day2 }, day1, day2],
      [{ start: day1Timed, includeTime: true }, day1Timed, null],
      [
        { start: day1Timed, end: day2Timed, includeTime: true },
        day1Timed,
        day2Timed,
      ],
    ];

    for (const [input, expectedStart, expectedEnd] of cases) {
      expect(getDateStart(input)).toBe(expectedStart);
      expect(getDateEnd(input)).toBe(expectedEnd);
      expect(
        datePropertyModelConfig.config.rawValue.toJson({
          value: input,
          data: {},
          dataSource,
        })
      ).toBe(expectedStart);
      expect(
        datePropertyModelConfig.config.rawValue.schema.safeParse(input).success
      ).toBe(true);
    }

    expect(
      datePropertyModelConfig.config.rawValue.schema.safeParse(Number.NaN)
        .success
    ).toBe(false);
    expect(
      datePropertyModelConfig.config.jsonValue.isEmpty({
        value: null,
        dataSource,
      })
    ).toBe(true);
    expect(
      datePropertyModelConfig.config.jsonValue.isEmpty({
        value: day1,
        dataSource,
      })
    ).toBe(false);
  });

  test('formats and parses legacy dates, timed dates, and date ranges cleanly', () => {
    const dataSource = {} as any;

    // 1. Legacy date yyyy-MM-dd
    expect(formatDatePropertyValue(day1)).toBe('2026-04-19');
    const parsedSingle = parseDatePropertyString('2026-04-19');
    expect(typeof parsedSingle).toBe('number');
    expect(parsedSingle).toBe(day1);
    expect(
      datePropertyModelConfig.config.rawValue.toString({
        value: parsedSingle,
        data: {},
      })
    ).toBe('2026-04-19');

    // 2. Date with time yyyy-MM-dd HH:mm
    const singleTimedVal: DatePropertyValue = {
      start: day1Timed,
      includeTime: true,
    };
    expect(formatDatePropertyValue(singleTimedVal)).toBe('2026-04-19 09:30');
    const parsedTimed = datePropertyModelConfig.config.rawValue.fromString({
      value: '2026-04-19 09:30',
      data: {},
      dataSource,
    }).value;
    expect(parsedTimed).toEqual(singleTimedVal);

    // 3. Date range yyyy-MM-dd → yyyy-MM-dd
    const rangeVal: DatePropertyValue = { start: day1, end: day2 };
    expect(formatDatePropertyValue(rangeVal)).toBe('2026-04-19 → 2026-04-22');
    expect(parseDatePropertyString('2026-04-19 → 2026-04-22')).toEqual(
      rangeVal
    );
    expect(parseDatePropertyString('2026-04-19 -> 2026-04-22')).toEqual(
      rangeVal
    );
    expect(parseDatePropertyString('2026-04-22 → 2026-04-19')).toEqual(
      rangeVal
    );

    // 4. Date range with time yyyy-MM-dd HH:mm → yyyy-MM-dd HH:mm
    const timedRangeVal: DatePropertyValue = {
      start: day1Timed,
      end: day2Timed,
      includeTime: true,
    };
    expect(formatDatePropertyValue(timedRangeVal)).toBe(
      '2026-04-19 09:30 → 2026-04-22 17:45'
    );
    expect(
      parseDatePropertyString('2026-04-19 09:30 → 2026-04-22 17:45')
    ).toEqual(timedRangeVal);

    // 5. Empty returns ''
    expect(formatDatePropertyValue(null)).toBe('');
  });

  test('rejects invalid date strings safely without returning NaN', () => {
    const invalidInputs = [
      '',
      '   ',
      'not a date',
      '2026-02-31',
      '2026-13-01',
      '2026-04-19 25:99',
      '2026-04-19 → invalid',
      'invalid → 2026-04-22',
      '12345',
      'NaN',
    ];

    for (const input of invalidInputs) {
      const parsed = parseDatePropertyString(input);
      expect(parsed).toBeNull();
      const fromStr = datePropertyModelConfig.config.rawValue.fromString({
        value: input,
        data: {},
        dataSource: {} as any,
      });
      expect(fromStr.value).toBeNull();
    }
  });

  test('setValue normalizes stored values automatically', () => {
    let stored: DatePropertyValue = null;
    const setValue = datePropertyModelConfig.config.rawValue.setValue!;

    setValue({
      data: {},
      dataSource: {} as any,
      value: null,
      newValue: { start: day1, includeTime: false },
      setValue: v => {
        stored = v;
      },
    });
    expect(stored).toBe(day1);

    setValue({
      data: {},
      dataSource: {} as any,
      value: stored,
      newValue: { start: day2, end: day1 },
      setValue: v => {
        stored = v;
      },
    });
    expect(stored).toEqual({ start: day1, end: day2 });
  });

  test('DateCellPopover toggles End date, Include time, and clears cleanly', async () => {
    ensureEffects();
    let latestDraft: DatePropertyValue = day1;
    let closed = false;

    const popover = new DateCellPopover();
    popover.initialValue = day1;
    popover.onDraftChange = v => {
      latestDraft = v;
    };
    popover.onClose = () => {
      closed = true;
    };
    document.body.append(popover);
    await popover.updateComplete;

    // Initially no end date or time inputs
    expect(
      popover.querySelector('input[type="date"][aria-label="End date"]')
    ).toBeNull();
    expect(
      popover.querySelector('input[type="time"][aria-label="Start time"]')
    ).toBeNull();

    // Toggle End date on
    const endDateToggle = popover.querySelector(
      'input[type="checkbox"][aria-label="End date"]'
    ) as HTMLInputElement;
    endDateToggle.checked = true;
    endDateToggle.dispatchEvent(new Event('change'));
    await popover.updateComplete;

    expect(
      popover.querySelector('input[type="date"][aria-label="End date"]')
    ).not.toBeNull();
    expect(latestDraft).toEqual({ start: day1, end: day1 });

    // Toggle Include time on
    const includeTimeToggle = popover.querySelector(
      'input[type="checkbox"][aria-label="Include time"]'
    ) as HTMLInputElement;
    includeTimeToggle.checked = true;
    includeTimeToggle.dispatchEvent(new Event('change'));
    await popover.updateComplete;

    expect(
      popover.querySelector('input[type="time"][aria-label="Start time"]')
    ).not.toBeNull();
    expect(
      popover.querySelector('input[type="time"][aria-label="End time"]')
    ).not.toBeNull();
    expect(latestDraft).toEqual({ start: day1, end: day1, includeTime: true });

    // Toggle both off -> collapses back to plain number
    endDateToggle.checked = false;
    endDateToggle.dispatchEvent(new Event('change'));
    includeTimeToggle.checked = false;
    includeTimeToggle.dispatchEvent(new Event('change'));
    await popover.updateComplete;
    expect(latestDraft).toBe(day1);

    // Click Clear -> sets null and closes
    const clearBtn = popover.querySelector('button') as HTMLButtonElement;
    clearBtn.click();
    expect(latestDraft).toBeNull();
    expect(closed).toBe(true);
  });
});
