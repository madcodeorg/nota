import { describe, expect, test } from 'vitest';

import {
  isCalendarEventCanceled,
  normalizeCalendarEventStatus,
} from '../calendar-event-status';

describe('calendar event status', () => {
  test.each(['canceled', 'cancelled', ' CANCELED ', ' CANCELLED '])(
    'normalizes %s as canceled',
    status => {
      expect(normalizeCalendarEventStatus(status)).toBe('canceled');
      expect(isCalendarEventCanceled(status)).toBe(true);
    }
  );

  test('normalizes other statuses without marking them canceled', () => {
    expect(normalizeCalendarEventStatus(' CONFIRMED ')).toBe('confirmed');
    expect(isCalendarEventCanceled('confirmed')).toBe(false);
    expect(normalizeCalendarEventStatus(null)).toBeNull();
  });
});
