import { describe, expect, test } from 'vitest';

import {
  decideMeetingCalendarTrigger,
  effectiveMeetingRecordingMode,
  meetingCalendarTriggerId,
  pruneMeetingTriggerHistory,
  selectUpcomingMeetingCalendarEvent,
} from '../../src/main/windows-manager/meeting-popup-scheduler';

const now = Date.parse('2026-07-16T14:00:00.000Z');

function event(
  input: Partial<
    Parameters<typeof selectUpcomingMeetingCalendarEvent>[0][number]
  > = {}
) {
  return {
    allDay: false,
    attendees: ['teammate@example.com'],
    endAt: '2026-07-16T14:30:00.000Z',
    id: 'event-1',
    meetingUrl: null,
    startAt: '2026-07-16T14:00:00.000Z',
    status: 'confirmed',
    ...input,
  };
}

describe('selectUpcomingMeetingCalendarEvent', () => {
  test('ignores canceled, ended, all-day, and non-meeting events', () => {
    const selected = selectUpcomingMeetingCalendarEvent(
      [
        event({ id: 'canceled', status: 'cancelled' }),
        event({ allDay: true, id: 'all-day' }),
        event({
          attendees: [],
          endAt: '2026-07-16T13:30:00.000Z',
          id: 'ended',
          startAt: '2026-07-16T13:00:00.000Z',
        }),
        event({ attendees: [], id: 'focus-block' }),
        event({
          attendees: [],
          id: 'video-call',
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
        }),
      ],
      now
    );

    expect(selected?.id).toBe('video-call');
  });

  test('selects the earliest valid attendee meeting', () => {
    const selected = selectUpcomingMeetingCalendarEvent(
      [
        event({
          id: 'later',
          startAt: '2026-07-16T15:00:00.000Z',
          endAt: '2026-07-16T15:30:00.000Z',
        }),
        event({ id: 'current' }),
      ],
      now
    );

    expect(selected?.id).toBe('current');
  });
});

describe('decideMeetingCalendarTrigger', () => {
  test('does nothing when calendar-triggered recording is disabled', () => {
    expect(
      decideMeetingCalendarTrigger({
        handled: {},
        mode: 'none',
        now,
        recordingStatus: 'idle',
        upcoming: event(),
      })
    ).toBeNull();
  });

  test('prompts once when a meeting becomes live', () => {
    const upcoming = event();
    const first = decideMeetingCalendarTrigger({
      handled: {},
      mode: 'prompt',
      now,
      recordingStatus: 'idle',
      upcoming,
    });

    expect(first).toEqual({
      action: 'prompt',
      key: `prompt:${upcoming.id}:${upcoming.startAt}`,
    });
    expect(
      decideMeetingCalendarTrigger({
        handled: { [first!.key]: now },
        mode: 'prompt',
        now,
        recordingStatus: 'idle',
        upcoming,
      })
    ).toBeNull();
  });

  test('does not prompt twice when EventKit and Google mirror the same meeting', () => {
    const triggerId = meetingCalendarTriggerId({
      endAt: event().endAt,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      startAt: event().startAt,
      title: 'Weekly planning',
    });
    const first = decideMeetingCalendarTrigger({
      handled: {},
      mode: 'prompt',
      now,
      recordingStatus: 'idle',
      upcoming: event({ id: 'eventkit-id', triggerId }),
    });

    expect(first).not.toBeNull();
    expect(
      decideMeetingCalendarTrigger({
        handled: { [first!.key]: now },
        mode: 'prompt',
        now,
        recordingStatus: 'idle',
        upcoming: event({
          endAt: '2026-07-16T10:30:00.000-04:00',
          id: 'google-id',
          startAt: '2026-07-16T10:00:00.000-04:00',
          triggerId,
        }),
      })
    ).toBeNull();
  });

  test('auto-starts at the event start, never before or during another recording', () => {
    const upcoming = event();
    expect(
      decideMeetingCalendarTrigger({
        handled: {},
        mode: 'auto-start',
        now: now - 1,
        recordingStatus: 'idle',
        upcoming,
      })
    ).toBeNull();
    expect(
      decideMeetingCalendarTrigger({
        handled: {},
        mode: 'auto-start',
        now,
        recordingStatus: 'recording',
        upcoming,
      })
    ).toBeNull();
    expect(
      decideMeetingCalendarTrigger({
        handled: {},
        mode: 'auto-start',
        now,
        recordingStatus: 'idle',
        upcoming,
      })
    ).toEqual({
      action: 'auto-start',
      key: `auto-start:${upcoming.id}:${upcoming.startAt}`,
    });
  });
});

test('unknown calendar selection downgrades auto-start to a prompt', () => {
  expect(effectiveMeetingRecordingMode('auto-start', false)).toBe('prompt');
  expect(effectiveMeetingRecordingMode('auto-start', true)).toBe('auto-start');
  expect(effectiveMeetingRecordingMode('none', false)).toBe('none');
});

test('meeting trigger identity ignores provider URL query differences', () => {
  const shared = {
    endAt: event().endAt,
    title: 'Weekly planning',
  };
  expect(
    meetingCalendarTriggerId({
      ...shared,
      meetingUrl: 'https://meet.google.com/abc-defg-hij?authuser=1',
      startAt: event().startAt,
    })
  ).toBe(
    meetingCalendarTriggerId({
      endAt: '2026-07-16T10:30:00.000-04:00',
      meetingUrl: 'https://meet.google.com/abc-defg-hij/',
      startAt: '2026-07-16T10:00:00.000-04:00',
      title: shared.title,
    })
  );
});

test('meeting trigger identity tolerates small provider time drift', () => {
  const shared = {
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    title: 'Weekly planning',
  };
  expect(
    meetingCalendarTriggerId({
      ...shared,
      endAt: '2026-07-16T14:30:00.000Z',
      startAt: '2026-07-16T14:00:00.000Z',
    })
  ).toBe(
    meetingCalendarTriggerId({
      ...shared,
      endAt: '2026-07-16T14:35:00.000Z',
      startAt: '2026-07-16T14:05:00.000Z',
    })
  );
});

test('meeting trigger identity keeps repeated same-link meetings separate', () => {
  const shared = {
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    title: 'Office hours',
  };

  expect(
    meetingCalendarTriggerId({
      ...shared,
      endAt: '2026-07-16T14:30:00.000Z',
      startAt: '2026-07-16T14:00:00.000Z',
    })
  ).not.toBe(
    meetingCalendarTriggerId({
      ...shared,
      endAt: '2026-07-16T16:30:00.000Z',
      startAt: '2026-07-16T16:00:00.000Z',
    })
  );
});

test('pruneMeetingTriggerHistory keeps only recent persisted decisions', () => {
  expect(
    pruneMeetingTriggerHistory(
      {
        future: now + 1,
        recent: now - 1000,
        stale: now - 49 * 60 * 60 * 1000,
      },
      now
    )
  ).toEqual({ recent: now - 1000 });
});
