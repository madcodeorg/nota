import { fetchAiBackend } from '../ai-backend';
import { applicationMenuSubjects } from '../application-menu/subject';
import { calendarHandlers } from '../calendar';
import {
  clearSecureGoogleSession,
  readSecureGoogleSession,
} from '../google-auth/secure-session';
import { resolveSecureGoogleSession } from '../google-auth/session-refresh';
import { logger } from '../logger';
import { recordingStateMachine } from '../recording/state-machine';
import { openExternalSafely } from '../security/open-external';
import { globalStateStorage } from '../shared-storage/storage';
import {
  fetchGoogleMeetingCalendarEvents,
  googleSessionAllowsCalendar,
  isGoogleSessionRevokedError,
} from './google-calendar-scheduler';
import { getMainWindow } from './main-window';
import {
  meetingCalendarTriggerId,
  selectUpcomingMeetingCalendarEvent,
} from './meeting-popup-scheduler';

const CALENDAR_LOOKAHEAD_MS = 8 * 60 * 60 * 1000;
const CALENDAR_LOOKBEHIND_MS = 5 * 60 * 1000;
const CALENDAR_CACHE_MS = 10 * 1000;
const GOOGLE_CALENDAR_CACHE_MS = 60 * 1000;
const GOOGLE_CALENDAR_TIMEOUT_MS = 8 * 1000;
const MEETING_SOON_MS = 10 * 60 * 1000;
export const BACKGROUND_CALENDAR_SELECTION_KEY =
  'nota:meeting-calendar-selection:v1';

type MeetingBackendSession = {
  createdAt: string;
  id: string;
  partialSegment?: unknown | null;
  providerId?: string | null;
  stt?: {
    message?: string | null;
    status?: string | null;
  } | null;
  status: 'recording' | 'stopped';
  transcriptSegments?: unknown[];
  updatedAt: string;
};

type MeetingListResponse = {
  meetings?: MeetingBackendSession[];
};

type CalendarStatus = {
  authorized: boolean;
  reason?: string | null;
  status: string;
  supported: boolean;
};

type Calendar = {
  id: string;
};

type CalendarEvent = {
  allDay: boolean;
  attendees?: unknown[];
  calendarColor?: string | null;
  calendarId: string;
  calendarName?: string | null;
  endAt: string;
  id: string;
  location?: string | null;
  meetingUrl?: string | null;
  notes?: string | null;
  source: 'eventkit' | 'google';
  startAt: string;
  status?: string | null;
  title: string;
  triggerId?: string;
  url?: string | null;
};

export type MeetingPopupState = {
  backend: {
    available: boolean;
    error?: string | null;
  };
  calendar: {
    authorized: boolean;
    reason?: string | null;
    status: string;
    supported: boolean;
  };
  now: string;
  recording: {
    elapsedMs?: number | null;
    meetingId?: string | null;
    providerId?: string | null;
    startTime?: number | null;
    status: 'idle' | 'paused' | 'recording';
    sttMessage?: string | null;
    sttStatus?: string | null;
    transcriptCount?: number;
  };
  upcoming: {
    calendarColor?: string | null;
    calendarName?: string | null;
    endAt: string;
    endsInMs: number;
    id: string;
    isLive: boolean;
    isSoon: boolean;
    meetingUrl?: string | null;
    source: 'eventkit' | 'google';
    selectionKnown: boolean;
    startAt: string;
    startsInMs: number;
    title: string;
    triggerId?: string;
    url?: string | null;
  } | null;
};

type CalendarSnapshot = Pick<MeetingPopupState, 'calendar' | 'upcoming'>;

let calendarCache:
  | {
      expiresAt: number;
      snapshot: CalendarSnapshot;
    }
  | undefined;
let calendarPromise: Promise<CalendarSnapshot> | undefined;
let googleCalendarCache:
  | {
      events: CalendarEvent[];
      expiresAt: number;
      refreshToken: string;
    }
  | undefined;

class CalendarBackendResponseError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function isRejectedGoogleCalendarCredential(error: unknown) {
  return (
    error instanceof CalendarBackendResponseError &&
    error.status === 401 &&
    /invalid (?:authentication )?credentials|unauthenticated|login required/i.test(
      error.message
    )
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const controller = init.signal ? null : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), 2500)
    : undefined;
  try {
    const response = await fetchAiBackend(path, {
      ...init,
      signal: init.signal ?? controller?.signal,
    });
    const data = (await response.json().catch(() => null)) as
      | T
      | { error?: string }
      | null;
    if (!response.ok) {
      const error =
        data && typeof data === 'object' && 'error' in data ? data.error : null;
      throw new CalendarBackendResponseError(
        error || `Nota backend request failed: ${response.status}`,
        response.status
      );
    }
    return data as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isMeetingLink(link: string) {
  const normalized = link.toLowerCase();
  return [
    'zoom.us/',
    'meet.google.com/',
    'teams.microsoft.com/',
    'microsoft.com/l/meetup-join/',
    'webex.com/',
    'gotomeeting.com/',
    'bluejeans.com/',
    'whereby.com/',
    'chime.aws/',
    'ringcentral.com/',
    'around.co/',
    'slack.com/huddle',
  ].some(host => normalized.includes(host));
}

function extractLinks(value?: string | null) {
  if (!value) {
    return [];
  }
  return (
    value
      .match(/https?:\/\/[^\s<>"']+/gi)
      ?.map(link => link.replace(/[),.;\]]+$/g, ''))
      .filter(Boolean) ?? []
  );
}

function extractKnownMeetingUrl(...values: (string | null | undefined)[]) {
  return values.flatMap(extractLinks).find(isMeetingLink) ?? null;
}

function emptyCalendarSnapshot(
  status: Partial<CalendarStatus> = {}
): CalendarSnapshot {
  return {
    calendar: {
      authorized: status.authorized ?? false,
      reason: status.reason ?? null,
      status: status.status ?? 'unknown',
      supported: status.supported ?? false,
    },
    upcoming: null,
  };
}

type LocalCalendarResult = {
  events: CalendarEvent[];
  status: CalendarStatus;
};

type GoogleCalendarResult = {
  connected: boolean;
  events: CalendarEvent[];
  reason?: string;
};

let calendarCacheGeneration = 0;

type BackgroundCalendarSelection = {
  selectedIds: string[];
  sourcePrefixes: string[];
};

function backgroundCalendarSelection(): BackgroundCalendarSelection | null {
  const value = globalStateStorage.get<unknown>(
    BACKGROUND_CALENDAR_SELECTION_KEY
  );
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    selectedIds?: unknown;
    sourcePrefixes?: unknown;
  };
  if (!Array.isArray(candidate.selectedIds)) return null;
  return {
    selectedIds: candidate.selectedIds.filter(
      (id): id is string => typeof id === 'string' && !!id
    ),
    sourcePrefixes: Array.isArray(candidate.sourcePrefixes)
      ? candidate.sourcePrefixes.filter(
          (prefix): prefix is string => typeof prefix === 'string' && !!prefix
        )
      : [],
  };
}

function selectedCalendarIdsForSource(source: 'eventkit' | 'google') {
  const selection = backgroundCalendarSelection();
  if (!selection) return { ids: null, known: false } as const;
  const prefix = `${source}:`;
  const known =
    selection.sourcePrefixes.includes(prefix) ||
    selection.selectedIds.some(id => id.startsWith(prefix));
  return {
    ids: known
      ? selection.selectedIds
          .filter(id => id.startsWith(prefix))
          .map(id => id.slice(prefix.length))
      : null,
    known,
  } as const;
}

export function invalidateMeetingPopupCalendarCache() {
  calendarCacheGeneration += 1;
  calendarCache = undefined;
  googleCalendarCache = undefined;
}

async function loadLocalCalendarEvents(
  now: number
): Promise<LocalCalendarResult> {
  try {
    const status =
      (await calendarHandlers.getLocalCalendarStatus()) as CalendarStatus;
    if (!status.supported || !status.authorized) {
      return { events: [], status };
    }

    const calendars =
      (await calendarHandlers.listLocalCalendars()) as Calendar[];
    const selected = selectedCalendarIdsForSource('eventkit');
    const selectedIds = selected.ids ? new Set(selected.ids) : null;
    const calendarIds = calendars
      .map(calendar => calendar.id)
      .filter(
        calendarId =>
          !!calendarId && (!selectedIds || selectedIds.has(calendarId))
      );
    if (!calendarIds.length) {
      return { events: [], status };
    }

    const events = (await calendarHandlers.listLocalCalendarEvents(
      undefined as never,
      {
        calendarIds,
        from: new Date(now - CALENDAR_LOOKBEHIND_MS).toISOString(),
        to: new Date(now + CALENDAR_LOOKAHEAD_MS).toISOString(),
      }
    )) as Omit<CalendarEvent, 'source'>[];

    return {
      events: events.map(event => {
        const meetingUrl =
          event.meetingUrl && isMeetingLink(event.meetingUrl)
            ? event.meetingUrl
            : extractKnownMeetingUrl(event.url, event.location, event.notes);
        return {
          ...event,
          meetingUrl,
          source: 'eventkit' as const,
          triggerId: meetingCalendarTriggerId({
            endAt: event.endAt,
            meetingUrl,
            startAt: event.startAt,
            title: event.title,
          }),
        };
      }),
      status,
    };
  } catch (error) {
    logger.warn('Failed to load Apple Calendar meeting state', error);
    return {
      events: [],
      status: {
        authorized: false,
        reason: errorMessage(error),
        status: 'unknown',
        supported: process.platform === 'darwin',
      },
    };
  }
}

async function loadGoogleCalendarEvents(
  now: number,
  generation: number
): Promise<GoogleCalendarResult> {
  const stored = readSecureGoogleSession();
  if (!stored || !googleSessionAllowsCalendar(stored)) {
    return { connected: false, events: [] };
  }

  const cached = googleCalendarCache;
  if (
    cached &&
    cached.expiresAt > now &&
    cached.refreshToken === stored.tokens.refreshToken
  ) {
    return { connected: true, events: cached.events };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GOOGLE_CALENDAR_TIMEOUT_MS
  );
  let sessionForRequest = stored;
  try {
    const session = await resolveSecureGoogleSession();
    if (!session || !googleSessionAllowsCalendar(session)) {
      return { connected: false, events: [] };
    }
    sessionForRequest = session;
    const events = await fetchGoogleMeetingCalendarEvents({
      accessToken: session.tokens.accessToken,
      calendarIds: selectedCalendarIdsForSource('google').ids ?? undefined,
      from: new Date(now - CALENDAR_LOOKBEHIND_MS).toISOString(),
      request: jsonRequest,
      signal: controller.signal,
      to: new Date(now + CALENDAR_LOOKAHEAD_MS).toISOString(),
    });
    if (generation === calendarCacheGeneration) {
      googleCalendarCache = {
        events,
        expiresAt: Date.now() + GOOGLE_CALENDAR_CACHE_MS,
        refreshToken: session.tokens.refreshToken,
      };
    }
    return { connected: true, events };
  } catch (error) {
    if (
      isGoogleSessionRevokedError(error) ||
      isRejectedGoogleCalendarCredential(error)
    ) {
      const current = readSecureGoogleSession();
      if (
        current?.tokens.refreshToken === sessionForRequest.tokens.refreshToken
      ) {
        clearSecureGoogleSession();
      }
    }
    logger.warn('Failed to load Google Calendar meeting state', error);
    return { connected: false, events: [], reason: errorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCalendarSnapshot(): Promise<CalendarSnapshot> {
  const cached = calendarCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }
  if (calendarPromise) {
    return calendarPromise;
  }

  const generation = calendarCacheGeneration;
  calendarPromise = (async () => {
    const now = Date.now();
    const [local, google] = await Promise.all([
      loadLocalCalendarEvents(now),
      loadGoogleCalendarEvents(now, generation),
    ]);
    const status =
      google.connected && !local.status.authorized
        ? {
            authorized: true,
            reason: null,
            status: 'authorized',
            supported: true,
          }
        : local.status;
    const upcoming = selectUpcomingMeetingCalendarEvent(
      [...local.events, ...google.events],
      now
    );
    if (!upcoming) {
      return emptyCalendarSnapshot({
        ...status,
        reason:
          status.reason ??
          (!local.status.supported ? (google.reason ?? null) : null),
      });
    }

    const startMs = Date.parse(upcoming.startAt);
    const endMs = Date.parse(upcoming.endAt);
    const startsInMs = startMs - now;
    const endsInMs = endMs - now;
    return {
      calendar: {
        authorized: status.authorized,
        reason: status.reason ?? null,
        status: status.status,
        supported: status.supported,
      },
      upcoming: {
        calendarColor: upcoming.calendarColor,
        calendarName: upcoming.calendarName,
        endAt: upcoming.endAt,
        endsInMs,
        id: upcoming.id,
        isLive: startsInMs <= 0 && endsInMs > 0,
        isSoon: startsInMs > 0 && startsInMs <= MEETING_SOON_MS,
        meetingUrl: upcoming.meetingUrl,
        source: upcoming.source,
        selectionKnown: selectedCalendarIdsForSource(upcoming.source).known,
        startAt: upcoming.startAt,
        startsInMs,
        title: upcoming.title,
        triggerId: upcoming.triggerId,
        url: upcoming.url,
      },
    };
  })();

  try {
    const snapshot = await calendarPromise;
    if (generation === calendarCacheGeneration) {
      calendarCache = {
        expiresAt: Date.now() + CALENDAR_CACHE_MS,
        snapshot,
      };
    }
    return snapshot;
  } finally {
    calendarPromise = undefined;
  }
}

async function loadBackendMeetingState(): Promise<{
  backend: MeetingPopupState['backend'];
  meeting: MeetingBackendSession | null;
}> {
  try {
    const data = await jsonRequest<MeetingListResponse>('/v1/meetings');
    return {
      backend: { available: true, error: null },
      meeting:
        data.meetings?.find(meeting => meeting.status === 'recording') ?? null,
    };
  } catch (error) {
    return {
      backend: { available: false, error: errorMessage(error) },
      meeting: null,
    };
  }
}

export async function getMeetingPopupState(): Promise<MeetingPopupState> {
  const [calendarSnapshot, backendState] = await Promise.all([
    loadCalendarSnapshot(),
    loadBackendMeetingState(),
  ]);
  const now = Date.now();
  const nativeRecording = recordingStateMachine.status;
  const activeBackendMeeting = backendState.meeting;
  const activeNativeRecording =
    activeBackendMeeting &&
    (nativeRecording?.status === 'recording' ||
      nativeRecording?.status === 'paused')
      ? nativeRecording
      : null;
  const startTime =
    activeNativeRecording?.startTime ??
    (activeBackendMeeting?.createdAt
      ? Date.parse(activeBackendMeeting.createdAt)
      : null);
  const activeStatus = activeBackendMeeting
    ? activeNativeRecording?.status === 'paused'
      ? 'paused'
      : 'recording'
    : 'idle';
  const upcoming = calendarSnapshot.upcoming
    ? {
        ...calendarSnapshot.upcoming,
        endsInMs: Date.parse(calendarSnapshot.upcoming.endAt) - now,
        isLive:
          Date.parse(calendarSnapshot.upcoming.startAt) <= now &&
          Date.parse(calendarSnapshot.upcoming.endAt) > now,
        isSoon:
          Date.parse(calendarSnapshot.upcoming.startAt) > now &&
          Date.parse(calendarSnapshot.upcoming.startAt) - now <=
            MEETING_SOON_MS,
        startsInMs: Date.parse(calendarSnapshot.upcoming.startAt) - now,
      }
    : null;

  return {
    ...calendarSnapshot,
    backend: backendState.backend,
    now: new Date(now).toISOString(),
    recording: {
      elapsedMs:
        startTime && Number.isFinite(startTime)
          ? Math.max(0, now - startTime)
          : null,
      meetingId: activeBackendMeeting?.id ?? null,
      providerId: activeBackendMeeting?.providerId ?? null,
      startTime,
      status: activeStatus,
      sttMessage: activeBackendMeeting?.stt?.message ?? null,
      sttStatus: activeBackendMeeting?.stt?.status ?? null,
      transcriptCount: activeBackendMeeting?.transcriptSegments?.length ?? 0,
    },
    upcoming,
  };
}

function openMeetingsPage(intent: { start?: boolean; stop?: boolean } = {}) {
  return getMainWindow()
    .then(window => {
      window.show();
      applicationMenuSubjects.openMeetingsPage$.next(intent);
    })
    .catch(error => {
      logger.error('Failed to open meetings page:', error);
      throw error;
    });
}

export function openMeetingPopupPage() {
  return openMeetingsPage();
}

export function startMeetingFromPopup() {
  return openMeetingsPage({ start: true });
}

export function stopMeetingFromPopup() {
  return openMeetingsPage({ stop: true });
}

export async function joinMeetingFromPopup(url: string) {
  await openExternalSafely(url);
}

export async function startAndJoinMeetingFromPopup(url: string) {
  await startMeetingFromPopup();
  await joinMeetingFromPopup(url);
}
