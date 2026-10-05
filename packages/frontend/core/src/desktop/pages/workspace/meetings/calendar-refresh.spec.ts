/**
 * @vitest-environment happy-dom
 */

import dayjs from 'dayjs';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { startMeetingCalendarRefresh } from './calendar-refresh';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startMeetingCalendarRefresh', () => {
  test('refreshes periodically, rolls the active day, and refreshes after resume', async () => {
    vi.useFakeTimers();
    let currentDay = dayjs('2026-07-16T23:58:00');
    const onRefresh = vi.fn();
    const cleanup = startMeetingCalendarRefresh({
      initialDay: currentDay,
      intervalMs: 60_000,
      now: () => currentDay,
      onRefresh,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({ dayChanged: false, reason: 'interval' })
    );

    currentDay = dayjs('2026-07-17T00:01:00');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({
        day: currentDay,
        dayChanged: true,
        reason: 'interval',
      })
    );

    window.dispatchEvent(new Event('focus'));
    expect(onRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({ dayChanged: false, reason: 'resume' })
    );

    cleanup();
  });

  test('does not refresh while hidden and removes every trigger on cleanup', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    const cleanup = startMeetingCalendarRefresh({
      initialDay: dayjs('2026-07-16'),
      intervalMs: 60_000,
      onRefresh,
    });

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    cleanup();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
