import { isCalendarEventCanceled } from '@nota/infra';

export type MeetingRecordingMode = 'auto-start' | 'none' | 'prompt';

export type MeetingCalendarEventCandidate = {
  allDay: boolean;
  attendees?: unknown[];
  endAt: string;
  id: string;
  meetingUrl?: string | null;
  startAt: string;
  status?: string | null;
  triggerId?: string;
};

export type MeetingTriggerHistory = Record<string, number>;

export type MeetingTriggerDecision = {
  action: 'auto-start' | 'prompt';
  key: string;
};

type MeetingCalendarEventTiming = Pick<
  MeetingCalendarEventCandidate,
  'endAt' | 'id' | 'startAt' | 'triggerId'
>;

const HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000;
const TRIGGER_START_BUCKET_MS = 15 * 60 * 1000;

export function effectiveMeetingRecordingMode(
  mode: MeetingRecordingMode,
  selectionKnown: boolean
): MeetingRecordingMode {
  return mode === 'auto-start' && !selectionKnown ? 'prompt' : mode;
}

function validEventTimes(event: MeetingCalendarEventTiming) {
  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function hasMeetingSignal(event: MeetingCalendarEventCandidate) {
  return Boolean(event.meetingUrl?.trim() || event.attendees?.length);
}

export function selectUpcomingMeetingCalendarEvent<
  T extends MeetingCalendarEventCandidate,
>(events: T[], now = Date.now()) {
  return (
    [...events]
      .filter(event => {
        if (event.allDay || isCalendarEventCanceled(event.status)) {
          return false;
        }
        if (!validEventTimes(event) || !hasMeetingSignal(event)) {
          return false;
        }
        return Date.parse(event.endAt) > now;
      })
      .sort(
        (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)
      )[0] ?? null
  );
}

export function meetingTriggerKey(
  event: Pick<MeetingCalendarEventTiming, 'id' | 'startAt' | 'triggerId'>,
  mode: Exclude<MeetingRecordingMode, 'none'>
) {
  return event.triggerId
    ? `${mode}:${event.triggerId}`
    : `${mode}:${event.id}:${event.startAt}`;
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedMeetingUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return value
      .trim()
      .toLowerCase()
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
}

/**
 * Creates an opaque, source-independent identity for mirrored calendar events.
 * EventKit and Google use different event IDs for the same meeting, so the
 * scheduler cannot use either provider ID alone to suppress duplicate prompts.
 */
export function meetingCalendarTriggerId(event: {
  endAt: string;
  meetingUrl?: string | null;
  startAt: string;
  title?: string | null;
}) {
  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  const calendarDay = Number.isFinite(startMs)
    ? new Date(startMs).toISOString().slice(0, 10)
    : event.startAt.slice(0, 10);
  // Keep mirrored providers within a few minutes in the same bucket without
  // collapsing two uses of the same recurring room link later that day.
  const startBucket = Number.isFinite(startMs)
    ? Math.round(startMs / TRIGGER_START_BUCKET_MS)
    : event.startAt;
  const durationBucket =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.max(1, Math.round((endMs - startMs) / (15 * 60 * 1000)))
      : event.endAt;
  const meetingUrl = normalizedMeetingUrl(event.meetingUrl);
  const title = event.title?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const identity = meetingUrl
    ? `url:${meetingUrl}|${calendarDay}|${startBucket}|${durationBucket}`
    : `title:${title}|${calendarDay}|${startBucket}|${durationBucket}`;
  return `meeting-${stableTextHash(identity)}`;
}

export function decideMeetingCalendarTrigger(input: {
  handled: MeetingTriggerHistory;
  mode: MeetingRecordingMode;
  now?: number;
  recordingStatus: 'idle' | 'paused' | 'recording';
  upcoming: MeetingCalendarEventTiming | null;
}): MeetingTriggerDecision | null {
  if (
    input.mode === 'none' ||
    input.recordingStatus !== 'idle' ||
    !input.upcoming ||
    !validEventTimes(input.upcoming)
  ) {
    return null;
  }

  const now = input.now ?? Date.now();
  const startMs = Date.parse(input.upcoming.startAt);
  const endMs = Date.parse(input.upcoming.endAt);
  if (startMs > now || endMs <= now) {
    return null;
  }

  const key = meetingTriggerKey(input.upcoming, input.mode);
  if (Object.hasOwn(input.handled, key)) {
    return null;
  }
  return { action: input.mode, key };
}

export function pruneMeetingTriggerHistory(
  history: MeetingTriggerHistory,
  now = Date.now()
) {
  const oldest = now - HISTORY_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(history).filter(
      ([, handledAt]) =>
        Number.isFinite(handledAt) && handledAt >= oldest && handledAt <= now
    )
  );
}
