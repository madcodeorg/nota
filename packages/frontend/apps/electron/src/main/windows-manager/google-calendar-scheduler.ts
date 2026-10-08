import {
  type MeetingCalendarEventCandidate,
  meetingCalendarTriggerId,
} from './meeting-popup-scheduler';

export const GOOGLE_SESSION_STORAGE_KEY = 'nota-google-tokens';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const CALENDAR_SCOPES = new Set([
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
]);

type GoogleTokens = {
  accessToken: string;
  authBrokerUrl?: string;
  expiresAt: number;
  refreshMode?: 'broker' | 'google';
  refreshToken: string;
  scopes?: string[];
};

export type StoredGoogleSession = {
  tokens: GoogleTokens;
  userInfo: Record<string, unknown>;
};

type GoogleCalendarEvent = {
  attendees?: {
    displayName?: string;
    email?: string;
    responseStatus?: string;
    self?: boolean;
  }[];
  calendarBackgroundColor?: string;
  calendarId?: string;
  calendarSummary?: string;
  conferenceData?: {
    entryPoints?: {
      entryPointType?: string;
      uri?: string;
    }[];
  };
  description?: string;
  end?: {
    date?: string;
    dateTime?: string;
  };
  hangoutLink?: string;
  htmlLink?: string;
  iCalUID?: string;
  id?: string;
  location?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  status?: string;
  summary?: string;
};

export type GoogleMeetingCalendarEvent = MeetingCalendarEventCandidate & {
  calendarColor?: string | null;
  calendarId: string;
  calendarName?: string | null;
  location?: string | null;
  notes?: string | null;
  source: 'google';
  title: string;
  url?: string | null;
};

type FetchLike = typeof fetch;
type GoogleCalendarBackendRequest = <T>(
  path: string,
  init?: RequestInit
) => Promise<T>;

class GoogleSessionRevokedError extends Error {
  override readonly name = 'GoogleSessionRevokedError';
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function parseStoredGoogleSession(
  value: unknown
): StoredGoogleSession | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as {
    tokens?: Record<string, unknown>;
    userInfo?: unknown;
  };
  if (
    !stored.tokens ||
    !stored.userInfo ||
    typeof stored.userInfo !== 'object'
  ) {
    return null;
  }

  const accessToken = nonEmptyString(stored.tokens.accessToken);
  const expiresAt = stored.tokens.expiresAt;
  if (
    !accessToken ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }

  const refreshMode = stored.tokens.refreshMode;
  const scopes = Array.isArray(stored.tokens.scopes)
    ? stored.tokens.scopes.filter(
        (scope): scope is string => typeof scope === 'string' && !!scope
      )
    : undefined;
  return {
    tokens: {
      accessToken,
      authBrokerUrl: nonEmptyString(stored.tokens.authBrokerUrl) ?? undefined,
      expiresAt,
      refreshMode:
        refreshMode === 'broker' || refreshMode === 'google'
          ? refreshMode
          : undefined,
      refreshToken: nonEmptyString(stored.tokens.refreshToken) ?? '',
      scopes,
    },
    userInfo: stored.userInfo as Record<string, unknown>,
  };
}

export function googleSessionAllowsCalendar(session: StoredGoogleSession) {
  const scopes = session.tokens.scopes;
  return !scopes?.length || scopes.some(scope => CALENDAR_SCOPES.has(scope));
}

function normalizeBrokerUrl(value: string) {
  const url = new URL(value.trim());
  const isLoopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Google auth broker must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Google auth broker URL cannot include credentials.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string | { message?: string };
    error_description?: string;
  } | null;
  const code = typeof body?.error === 'string' ? body.error : null;
  const objectMessage =
    body?.error && typeof body.error === 'object'
      ? body.error.message
      : undefined;
  const message =
    body?.error_description ??
    code ??
    objectMessage ??
    `Google request failed with HTTP ${response.status}`;
  const normalized = `${code ?? ''} ${message}`.toLowerCase();
  if (
    response.status === 401 ||
    code === 'invalid_grant' ||
    code === 'invalid_token' ||
    /invalid (?:broker|refresh) token|refresh token (?:expired|revoked)/.test(
      normalized
    )
  ) {
    return new GoogleSessionRevokedError(message);
  }
  return new Error(message);
}

export function isGoogleSessionRevokedError(error: unknown) {
  return error instanceof GoogleSessionRevokedError;
}

export async function resolveGoogleCalendarSession(input: {
  brokerUrl: string;
  clientId: string;
  clientSecret?: string;
  fetchFn?: FetchLike;
  now?: number;
  session: StoredGoogleSession;
  signal?: AbortSignal;
}) {
  const now = input.now ?? Date.now();
  if (now < input.session.tokens.expiresAt - REFRESH_BEFORE_EXPIRY_MS) {
    return input.session;
  }
  if (!input.session.tokens.refreshToken) {
    throw new Error('Google Calendar authorization needs to be renewed.');
  }

  const fetchFn = input.fetchFn ?? fetch;
  let response: Response;
  if (input.session.tokens.refreshMode === 'broker') {
    const configuredBrokerUrl =
      input.session.tokens.authBrokerUrl || input.brokerUrl;
    if (!configuredBrokerUrl.trim()) {
      throw new Error('Google auth broker URL is missing.');
    }
    const brokerUrl = normalizeBrokerUrl(configuredBrokerUrl);
    response = await fetchFn(`${brokerUrl}/api/google/refresh`, {
      body: JSON.stringify({
        refreshToken: input.session.tokens.refreshToken,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: input.signal,
    });
  } else {
    if (!input.clientId.trim()) {
      throw new Error('Google OAuth client ID is missing.');
    }
    response = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      body: new URLSearchParams({
        client_id: input.clientId,
        ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
        grant_type: 'refresh_token',
        refresh_token: input.session.tokens.refreshToken,
      }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      signal: input.signal,
    });
  }

  if (!response.ok) {
    throw await responseError(response);
  }
  const data = (await response.json()) as {
    access_token?: string;
    accessToken?: string;
    expires_in?: number;
    expiresIn?: number;
    refresh_token?: string;
    refreshToken?: string;
  };
  const accessToken = nonEmptyString(data.accessToken ?? data.access_token);
  const expiresIn = data.expiresIn ?? data.expires_in;
  if (
    !accessToken ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error('Google token refresh returned an invalid response.');
  }

  return {
    ...input.session,
    tokens: {
      ...input.session.tokens,
      accessToken,
      expiresAt: now + expiresIn * 1000,
      refreshToken:
        nonEmptyString(data.refreshToken ?? data.refresh_token) ??
        input.session.tokens.refreshToken,
    },
  } satisfies StoredGoogleSession;
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
  if (!value) return [];
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

function googleEventDate(value?: { date?: string; dateTime?: string }) {
  if (value?.dateTime) return value.dateTime;
  if (value?.date) return `${value.date}T00:00:00`;
  return null;
}

function googleConferenceUrl(event: GoogleCalendarEvent) {
  const entryPoints = event.conferenceData?.entryPoints ?? [];
  return (
    event.hangoutLink ??
    entryPoints.find(entry => entry.entryPointType === 'video')?.uri ??
    entryPoints.find(entry => entry.uri?.startsWith('https://'))?.uri ??
    null
  );
}

function toMeetingEvent(
  event: GoogleCalendarEvent
): GoogleMeetingCalendarEvent | null {
  const selfAttendee = event.attendees?.find(attendee => attendee.self);
  if (selfAttendee?.responseStatus?.toLowerCase() === 'declined') {
    return null;
  }
  if (!event.calendarId) return null;
  const startAt = googleEventDate(event.start);
  const endAt = googleEventDate(event.end);
  if (!startAt || !endAt) return null;
  const meetingUrl =
    googleConferenceUrl(event) ??
    extractKnownMeetingUrl(event.htmlLink, event.location, event.description);
  const title = event.summary?.trim() || 'Meeting';
  const externalId = event.iCalUID ?? event.id;
  if (!externalId) return null;

  return {
    allDay: Boolean(event.start?.date || event.end?.date),
    attendees: event.attendees ?? [],
    calendarColor: event.calendarBackgroundColor ?? null,
    calendarId: event.calendarId,
    calendarName: event.calendarSummary ?? null,
    endAt,
    id: `google:${event.calendarId}:${externalId}`,
    location: event.location ?? null,
    meetingUrl,
    notes: event.description ?? null,
    source: 'google',
    startAt,
    status: event.status ?? null,
    title,
    triggerId: meetingCalendarTriggerId({
      endAt,
      meetingUrl,
      startAt,
      title,
    }),
    url: event.htmlLink ?? null,
  };
}

export async function fetchGoogleMeetingCalendarEvents(input: {
  accessToken: string;
  calendarIds?: string[];
  from: string;
  request: GoogleCalendarBackendRequest;
  signal?: AbortSignal;
  to: string;
}) {
  const headers = { Authorization: `Bearer ${input.accessToken}` };
  const calendarIds = input.calendarIds
    ? [...new Set(input.calendarIds.filter(Boolean))]
    : await input
        .request<{
          calendars?: { id?: string }[];
        }>('/v1/google/calendar/calendars', {
          headers,
          signal: input.signal,
        })
        .then(result =>
          (result.calendars ?? [])
            .map(calendar => calendar.id)
            .filter((id): id is string => !!id)
        );
  if (!calendarIds.length) return [] satisfies GoogleMeetingCalendarEvent[];

  const data = await input.request<{ events?: GoogleCalendarEvent[] }>(
    '/v1/google/calendar/events',
    {
      body: JSON.stringify({
        calendarIds,
        from: input.from,
        to: input.to,
      }),
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: input.signal,
    }
  );
  return (data.events ?? [])
    .map(toMeetingEvent)
    .filter((event): event is GoogleMeetingCalendarEvent => !!event);
}
