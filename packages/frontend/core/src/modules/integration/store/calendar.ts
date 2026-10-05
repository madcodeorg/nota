import {
  type CalendarAccountsQuery,
  calendarAccountsQuery,
  type CalendarEventsQuery,
  calendarEventsQuery,
  CalendarProviderType,
  type UpdateWorkspaceCalendarsMutation,
  updateWorkspaceCalendarsMutation,
  type WorkspaceCalendarItemInput,
  type WorkspaceCalendarsQuery,
  workspaceCalendarsQuery,
} from '@nota/graphql';
import { Store } from '@nota/infra';

import type { WorkspaceServerService } from '../../cloud';
import { DesktopApiService } from '../../desktop-api';
import { GoogleAuthService } from '../../google-auth';
import type { WorkspaceService } from '../../workspace';
import type { LocalCalendarStatus } from '../type';

const LOCAL_ACCOUNT_ID = 'eventkit';
const LOCAL_WORKSPACE_CALENDAR_ID = 'eventkit-workspace-calendar';
const LOCAL_SUBSCRIPTION_PREFIX = 'eventkit:';
const GOOGLE_ACCOUNT_ID = 'google';
const GOOGLE_WORKSPACE_CALENDAR_ID = 'google-workspace-calendar';
const GOOGLE_SUBSCRIPTION_PREFIX = 'google:';
const USER_SELECTION_STORAGE_PREFIX = 'nota:user-calendar-selection:';
const LOCAL_SELECTION_STORAGE_PREFIX =
  'nota:local-eventkit-calendar-selection:';
const BACKGROUND_CALENDAR_SELECTION_KEY = 'nota:meeting-calendar-selection:v1';
const CLOUD_QUERY_TIMEOUT_MS = 2500;

type CalendarAccount = NonNullable<
  CalendarAccountsQuery['currentUser']
>['calendarAccounts'][number];
type CalendarSubscription = CalendarAccount['calendars'][number];
type WorkspaceCalendar =
  WorkspaceCalendarsQuery['workspace']['calendars'][number];
type WorkspaceCalendarItem = WorkspaceCalendar['items'][number];
type CalendarEventObject =
  CalendarEventsQuery['workspace']['calendars'][number]['events'][number];
type UserCalendarSelection = {
  selectedIds: string[];
  sourcePrefixes?: string[] | null;
  updatedAt?: string;
};
type SharedStateStorage = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
};
type WorkspaceCalendarUpdateResult = {
  calendars: WorkspaceCalendar[];
  errors: Error[];
};
export type CalendarSource = 'cloud' | 'eventkit' | 'google';
export type WorkspaceCalendarSource = CalendarSource;
type CalendarAccountFetchResult = {
  accounts: CalendarAccount[];
  errors: Error[];
  successfulSourceIds: CalendarSource[];
  totalSources: number;
};
type WorkspaceCalendarFetchResult = WorkspaceCalendarUpdateResult & {
  successfulSourceIds: WorkspaceCalendarSource[];
  successfulSources: number;
  totalSources: number;
};
type LocalCalendar = {
  allowsContentModifications?: boolean;
  color?: string | null;
  id: string;
  title: string;
};
type LocalCalendarAttendee = {
  email?: string | null;
  name?: string | null;
  role?: string | null;
  status?: string | null;
  type?: string | null;
  url?: string | null;
};
type LocalCalendarEvent = {
  allDay: boolean;
  attendees?: LocalCalendarAttendee[];
  availability?: string | null;
  calendarColor?: string | null;
  calendarId: string;
  calendarName?: string | null;
  endAt: string;
  externalEventId?: string;
  id: string;
  location?: string | null;
  meetingUrl?: string | null;
  notes?: string | null;
  organizer?: LocalCalendarAttendee;
  startAt: string;
  status?: string | null;
  title: string;
  url?: string | null;
};
type GoogleCalendar = {
  accessRole?: string;
  backgroundColor?: string;
  id: string;
  primary?: boolean;
  selected?: boolean;
  summary?: string;
  timeZone?: string;
};
type GoogleCalendarAttendee = {
  displayName?: string;
  email?: string;
  responseStatus?: string;
  self?: boolean;
};
type GoogleCalendarEvent = {
  attendees?: GoogleCalendarAttendee[];
  calendarBackgroundColor?: string;
  calendarId: string;
  calendarSummary?: string;
  calendarTimeZone?: string;
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
    timeZone?: string;
  };
  hangoutLink?: string;
  htmlLink?: string;
  iCalUID?: string;
  id?: string;
  location?: string;
  organizer?: {
    displayName?: string;
    email?: string;
    self?: boolean;
  };
  recurringEventId?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  status?: string;
  summary?: string;
};

function localSubscriptionId(calendarId: string) {
  return `${LOCAL_SUBSCRIPTION_PREFIX}${calendarId}`;
}

function googleSubscriptionId(calendarId: string) {
  return `${GOOGLE_SUBSCRIPTION_PREFIX}${calendarId}`;
}

function calendarIdFromLocalSubscription(subscriptionId: string) {
  return subscriptionId.startsWith(LOCAL_SUBSCRIPTION_PREFIX)
    ? subscriptionId.slice(LOCAL_SUBSCRIPTION_PREFIX.length)
    : subscriptionId;
}

function isLocalSubscriptionId(subscriptionId: string) {
  return subscriptionId.startsWith(LOCAL_SUBSCRIPTION_PREFIX);
}

function calendarIdFromGoogleSubscription(subscriptionId: string) {
  return subscriptionId.startsWith(GOOGLE_SUBSCRIPTION_PREFIX)
    ? subscriptionId.slice(GOOGLE_SUBSCRIPTION_PREFIX.length)
    : subscriptionId;
}

function isGoogleSubscriptionId(subscriptionId: string) {
  return subscriptionId.startsWith(GOOGLE_SUBSCRIPTION_PREFIX);
}

function isUserOwnedSubscriptionId(subscriptionId: string) {
  return (
    isLocalSubscriptionId(subscriptionId) ||
    isGoogleSubscriptionId(subscriptionId)
  );
}

function attendeeLabel(attendee: LocalCalendarAttendee) {
  return attendee.name || attendee.email || attendee.url || null;
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

function extractMeetingUrl(...values: (string | null | undefined)[]) {
  const links = values.flatMap(extractLinks);
  return links.find(isMeetingLink) ?? links[0] ?? null;
}

function normalizeBrokerUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function googleDateToEventDate(value?: { date?: string; dateTime?: string }) {
  if (value?.dateTime) return value.dateTime;
  if (value?.date) return `${value.date}T00:00:00`;
  return new Date().toISOString();
}

function googleAttendeeLabel(attendee: GoogleCalendarAttendee) {
  return attendee.displayName || attendee.email || null;
}

function googleConferenceUrl(event: GoogleCalendarEvent) {
  return (
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find(entry => entry.uri)?.uri ??
    null
  );
}

async function runRemoteCalendarQuery<T>(
  query: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener('abort', abort, { once: true });
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('Remote calendar query timed out'));
      }, CLOUD_QUERY_TIMEOUT_MS);
    });
    return await Promise.race([query(controller.signal), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    signal?.removeEventListener('abort', abort);
  }
}

export class CalendarStore extends Store {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
  }

  private get gql() {
    return this.workspaceServerService.server?.gql;
  }

  private get workspaceId() {
    return this.workspaceService.workspace.id;
  }

  private get desktopApi() {
    return this.framework.getOptional(DesktopApiService);
  }

  private get localCalendarHandler() {
    return this.desktopApi?.handler.calendar;
  }

  private get googleAuthService() {
    return this.framework.getOptional(GoogleAuthService);
  }

  private get userSelectionStorageKey() {
    return `${USER_SELECTION_STORAGE_PREFIX}${this.workspaceId}`;
  }

  private get legacyLocalSelectionStorageKey() {
    return `${LOCAL_SELECTION_STORAGE_PREFIX}${this.workspaceId}`;
  }

  private get sharedGlobalState(): SharedStateStorage | null {
    if (!BUILD_CONFIG.isElectron) return null;
    return (
      (
        globalThis as {
          __sharedStorage?: { globalState?: SharedStateStorage };
        }
      ).__sharedStorage?.globalState ?? null
    );
  }

  private publishBackgroundCalendarSelection(selection: UserCalendarSelection) {
    const storage = this.sharedGlobalState;
    if (!storage) return;
    const next = {
      selectedIds: selection.selectedIds,
      sourcePrefixes: selection.sourcePrefixes ?? [],
      updatedAt: selection.updatedAt ?? new Date().toISOString(),
    };
    const current = storage.get<typeof next>(BACKGROUND_CALENDAR_SELECTION_KEY);
    if (
      current &&
      JSON.stringify(current.selectedIds) ===
        JSON.stringify(next.selectedIds) &&
      JSON.stringify(current.sourcePrefixes) ===
        JSON.stringify(next.sourcePrefixes)
    ) {
      return;
    }
    storage.set(BACKGROUND_CALENDAR_SELECTION_KEY, next);
  }

  private readUserSelection(): UserCalendarSelection | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw =
        window.localStorage.getItem(this.userSelectionStorageKey) ??
        window.localStorage.getItem(this.legacyLocalSelectionStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        selectedIds?: unknown;
        sourcePrefixes?: unknown;
        updatedAt?: unknown;
      };
      const selectedIds = Array.isArray(parsed.selectedIds)
        ? parsed.selectedIds.filter(
            (id): id is string => typeof id === 'string' && !!id
          )
        : null;
      if (!selectedIds) return null;
      const sourcePrefixes = Array.isArray(parsed.sourcePrefixes)
        ? parsed.sourcePrefixes.filter(
            (id): id is string => typeof id === 'string' && !!id
          )
        : null;
      const selection = {
        selectedIds,
        sourcePrefixes,
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
      this.publishBackgroundCalendarSelection(selection);
      return selection;
    } catch {
      return null;
    }
  }

  private writeUserSelection(selectedIds: string[], sourcePrefixes: string[]) {
    if (typeof window === 'undefined') return;
    const selection = {
      selectedIds,
      sourcePrefixes,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(
        this.userSelectionStorageKey,
        JSON.stringify(selection)
      );
    } catch {
      // Calendar selection is an enhancement; the app can still show all calendars.
    }
    this.publishBackgroundCalendarSelection(selection);
  }

  private updateUserSelectionForSources(
    selectedIds: string[],
    sourcePrefixes: string[]
  ) {
    if (sourcePrefixes.length === 0) return;

    const current = this.readUserSelection();
    const replacesSource = (id: string) =>
      sourcePrefixes.some(prefix => id.startsWith(prefix));
    const nextSelectedIds = [
      ...(current?.selectedIds ?? []).filter(id => !replacesSource(id)),
      ...selectedIds.filter(id => replacesSource(id)),
    ];
    const nextSourcePrefixes = [
      ...(current?.sourcePrefixes ?? []).filter(
        prefix => !sourcePrefixes.includes(prefix)
      ),
      ...sourcePrefixes,
    ];
    this.writeUserSelection(
      [...new Set(nextSelectedIds)],
      [...new Set(nextSourcePrefixes)]
    );
  }

  private selectedSubscriptionIdsForSource(
    calendars: CalendarSubscription[],
    sourcePrefix: string
  ) {
    const savedSelection = this.readUserSelection();
    const allIds = calendars.map(calendar => calendar.id);
    if (!savedSelection) {
      return allIds;
    }

    const selectedIds = savedSelection.selectedIds.filter(id =>
      id.startsWith(sourcePrefix)
    );
    const sourceWasExplicitlySaved =
      savedSelection.sourcePrefixes?.includes(sourcePrefix) ??
      savedSelection.selectedIds.some(id => id.startsWith(sourcePrefix));

    return sourceWasExplicitlySaved ? selectedIds : allIds;
  }

  async fetchLocalCalendarStatus(): Promise<LocalCalendarStatus> {
    const handler = this.localCalendarHandler;
    if (!handler) {
      return {
        available: false,
        authorized: false,
        reason: 'Desktop calendar bridge is unavailable.',
        status: 'unsupported',
        supported: false,
      };
    }

    return handler.getLocalCalendarStatus();
  }

  async requestLocalCalendarAccess(): Promise<LocalCalendarStatus> {
    const handler = this.localCalendarHandler;
    if (!handler) {
      return {
        available: false,
        authorized: false,
        reason: 'Desktop calendar bridge is unavailable.',
        status: 'unsupported',
        supported: false,
      };
    }

    return handler.requestLocalCalendarAccess();
  }

  async openLocalCalendarSettings() {
    return (
      this.localCalendarHandler?.showLocalCalendarPermissionSetting() ?? false
    );
  }

  private async fetchLocalCalendars(signal?: AbortSignal) {
    if (signal?.aborted) return [] satisfies LocalCalendar[];
    const handler = this.localCalendarHandler;
    if (!handler) return [] satisfies LocalCalendar[];

    const status = await handler.getLocalCalendarStatus();
    if (!status.supported || !status.authorized) {
      return [] satisfies LocalCalendar[];
    }

    const calendars = await handler.listLocalCalendars();
    return Array.isArray(calendars)
      ? (calendars as LocalCalendar[])
      : ([] satisfies LocalCalendar[]);
  }

  private localAccountFromCalendars(calendars: LocalCalendar[]) {
    if (calendars.length === 0) return null;

    const now = new Date().toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    return {
      __typename: 'CalendarAccountObjectType',
      id: LOCAL_ACCOUNT_ID,
      provider: CalendarProviderType.CalDAV,
      providerAccountId: LOCAL_ACCOUNT_ID,
      displayName: 'Apple Calendar',
      email: null,
      status: 'Connected',
      lastError: null,
      refreshIntervalMinutes: 5,
      calendarsCount: calendars.length,
      createdAt: now,
      updatedAt: now,
      calendars: calendars.map(calendar => {
        return {
          __typename: 'CalendarSubscriptionObjectType',
          id: localSubscriptionId(calendar.id),
          accountId: LOCAL_ACCOUNT_ID,
          provider: CalendarProviderType.CalDAV,
          externalCalendarId: calendar.id,
          displayName: calendar.title,
          timezone,
          color: calendar.color ?? null,
          enabled: true,
          lastSyncAt: null,
        } satisfies CalendarSubscription;
      }),
    } satisfies CalendarAccount;
  }

  private async fetchLocalAccount(signal?: AbortSignal) {
    const calendars = await this.fetchLocalCalendars(signal);
    return this.localAccountFromCalendars(calendars);
  }

  private localWorkspaceCalendarFromAccount(
    account: CalendarAccount | null,
    selectedIdsOverride?: string[]
  ) {
    if (!account) return null;

    const selectedIds =
      selectedIdsOverride ??
      this.selectedSubscriptionIdsForSource(
        account.calendars,
        LOCAL_SUBSCRIPTION_PREFIX
      );
    const selectedSet = new Set(selectedIds);
    const items = account.calendars
      .filter(calendar => selectedSet.has(calendar.id))
      .map((calendar, index) => {
        return {
          __typename: 'WorkspaceCalendarItemObjectType',
          id: `${LOCAL_WORKSPACE_CALENDAR_ID}:${calendar.id}`,
          subscriptionId: calendar.id,
          sortOrder: index,
          colorOverride: null,
          enabled: true,
        } satisfies WorkspaceCalendarItem;
      });

    return {
      __typename: 'WorkspaceCalendarObjectType',
      id: LOCAL_WORKSPACE_CALENDAR_ID,
      workspaceId: this.workspaceId,
      createdByUserId: 'local',
      displayNameOverride: 'Apple Calendar',
      colorOverride: null,
      enabled: true,
      items,
    } satisfies WorkspaceCalendar;
  }

  private async fetchLocalWorkspaceCalendar(signal?: AbortSignal) {
    return this.localWorkspaceCalendarFromAccount(
      await this.fetchLocalAccount(signal)
    );
  }

  private async updateLocalWorkspaceCalendars(
    items: WorkspaceCalendarItemInput[]
  ) {
    const calendars = await this.fetchLocalCalendars();
    const account = this.localAccountFromCalendars(calendars);
    return this.localWorkspaceCalendarFromAccount(
      account,
      items
        .filter(item => isLocalSubscriptionId(item.subscriptionId))
        .map(item => item.subscriptionId)
    );
  }

  private async fetchLocalEvents(
    workspaceCalendarId: string,
    from: string,
    to: string,
    signal?: AbortSignal
  ) {
    if (
      workspaceCalendarId !== LOCAL_WORKSPACE_CALENDAR_ID ||
      signal?.aborted
    ) {
      return [] satisfies CalendarEventObject[];
    }

    const handler = this.localCalendarHandler;
    if (!handler) return [] satisfies CalendarEventObject[];

    const workspaceCalendar = await this.fetchLocalWorkspaceCalendar(signal);
    const calendarIds =
      workspaceCalendar?.items
        .filter(item => item.enabled)
        .map(item => calendarIdFromLocalSubscription(item.subscriptionId)) ??
      [];
    if (calendarIds.length === 0) {
      return [] satisfies CalendarEventObject[];
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    const events = await handler.listLocalCalendarEvents({
      calendarIds,
      from,
      to,
    });
    const normalizedEvents = Array.isArray(events)
      ? (events as LocalCalendarEvent[])
      : ([] satisfies LocalCalendarEvent[]);

    return normalizedEvents.map(event => {
      const eventId = event.externalEventId ?? event.id;
      const attendees =
        event.attendees
          ?.map(attendeeLabel)
          .filter((name): name is string => !!name) ?? [];
      return {
        __typename: 'CalendarEventObjectType',
        id: `${LOCAL_SUBSCRIPTION_PREFIX}${eventId}`,
        subscriptionId: localSubscriptionId(event.calendarId),
        externalEventId: eventId,
        recurrenceId: null,
        status: event.status ?? event.availability ?? null,
        title: event.title,
        description: event.notes ?? null,
        location: event.location ?? null,
        startAtUtc: event.startAt,
        endAtUtc: event.endAt,
        originalTimezone: timezone,
        allDay: event.allDay,
        attendees,
        calendarColor: event.calendarColor,
        calendarName: event.calendarName,
        meetingUrl:
          event.meetingUrl ??
          extractMeetingUrl(event.url, event.location, event.notes),
        notes: event.notes,
        source: 'eventkit',
        url: event.url,
      } as CalendarEventObject & {
        attendees?: string[];
        calendarColor?: string | null;
        calendarName?: string | null;
        meetingUrl?: string | null;
        notes?: string | null;
        source?: 'eventkit';
        url?: string | null;
      };
    });
  }

  private googleCalendarApiUrl(path: string) {
    const brokerUrl = normalizeBrokerUrl(BUILD_CONFIG.googleAuthBrokerUrl);
    return brokerUrl
      ? `${brokerUrl}/api/google/calendar${path}`
      : `/v1/google/calendar${path}`;
  }

  private async fetchGoogleCalendarApi<T>(
    path: string,
    init: RequestInit = {}
  ) {
    const accessToken = await this.googleAuthService?.session.getAccessToken();
    if (!accessToken) {
      throw new Error('Google account is not connected');
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(this.googleCalendarApiUrl(path), {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        body?.error ?? `Google Calendar request failed: ${response.status}`
      );
    }

    return (await response.json()) as T;
  }

  private async fetchGoogleCalendars(signal?: AbortSignal) {
    if (signal?.aborted) return [] satisfies GoogleCalendar[];
    if (this.googleAuthService?.session.status$.value !== 'connected') {
      return [] satisfies GoogleCalendar[];
    }

    const data = await this.fetchGoogleCalendarApi<{
      calendars?: GoogleCalendar[];
    }>('/calendars', { signal });
    return (data.calendars ?? []).filter(
      (calendar): calendar is GoogleCalendar =>
        typeof calendar.id === 'string' && calendar.id.length > 0
    );
  }

  private googleAccountFromCalendars(calendars: GoogleCalendar[]) {
    const userInfo = this.googleAuthService?.session.userInfo$.value;
    if (!userInfo || calendars.length === 0) return null;

    const now = new Date().toISOString();
    return {
      __typename: 'CalendarAccountObjectType',
      id: GOOGLE_ACCOUNT_ID,
      provider: CalendarProviderType.Google,
      providerAccountId: userInfo.sub,
      displayName: userInfo.name || userInfo.email || 'Google Calendar',
      email: userInfo.email,
      status: 'Connected',
      lastError: null,
      refreshIntervalMinutes: 5,
      calendarsCount: calendars.length,
      createdAt: now,
      updatedAt: now,
      calendars: calendars.map(calendar => {
        return {
          __typename: 'CalendarSubscriptionObjectType',
          id: googleSubscriptionId(calendar.id),
          accountId: GOOGLE_ACCOUNT_ID,
          provider: CalendarProviderType.Google,
          externalCalendarId: calendar.id,
          displayName: calendar.summary ?? calendar.id,
          timezone: calendar.timeZone ?? null,
          color: calendar.backgroundColor ?? null,
          enabled: true,
          lastSyncAt: null,
        } satisfies CalendarSubscription;
      }),
    } satisfies CalendarAccount;
  }

  private async fetchGoogleAccount(signal?: AbortSignal) {
    const calendars = await this.fetchGoogleCalendars(signal);
    return this.googleAccountFromCalendars(calendars);
  }

  private googleWorkspaceCalendarFromAccount(
    account: CalendarAccount | null,
    selectedIdsOverride?: string[]
  ) {
    if (!account) return null;

    const selectedIds =
      selectedIdsOverride ??
      this.selectedSubscriptionIdsForSource(
        account.calendars,
        GOOGLE_SUBSCRIPTION_PREFIX
      );
    const selectedSet = new Set(selectedIds);
    const items = account.calendars
      .filter(calendar => selectedSet.has(calendar.id))
      .map((calendar, index) => {
        return {
          __typename: 'WorkspaceCalendarItemObjectType',
          id: `${GOOGLE_WORKSPACE_CALENDAR_ID}:${calendar.id}`,
          subscriptionId: calendar.id,
          sortOrder: index,
          colorOverride: null,
          enabled: true,
        } satisfies WorkspaceCalendarItem;
      });

    return {
      __typename: 'WorkspaceCalendarObjectType',
      id: GOOGLE_WORKSPACE_CALENDAR_ID,
      workspaceId: this.workspaceId,
      createdByUserId: 'local',
      displayNameOverride: 'Google Calendar',
      colorOverride: null,
      enabled: true,
      items,
    } satisfies WorkspaceCalendar;
  }

  private async fetchGoogleWorkspaceCalendar(signal?: AbortSignal) {
    return this.googleWorkspaceCalendarFromAccount(
      await this.fetchGoogleAccount(signal)
    );
  }

  private async updateGoogleWorkspaceCalendars(
    items: WorkspaceCalendarItemInput[],
    signal?: AbortSignal
  ) {
    const calendars = await this.fetchGoogleCalendars(signal);
    const account = this.googleAccountFromCalendars(calendars);
    return this.googleWorkspaceCalendarFromAccount(
      account,
      items
        .filter(item => isGoogleSubscriptionId(item.subscriptionId))
        .map(item => item.subscriptionId)
    );
  }

  private async fetchGoogleEvents(
    workspaceCalendarId: string,
    from: string,
    to: string,
    signal?: AbortSignal
  ) {
    if (
      workspaceCalendarId !== GOOGLE_WORKSPACE_CALENDAR_ID ||
      signal?.aborted
    ) {
      return [] satisfies CalendarEventObject[];
    }

    const workspaceCalendar = await this.fetchGoogleWorkspaceCalendar(signal);
    const calendarIds =
      workspaceCalendar?.items
        .filter(item => item.enabled)
        .map(item => calendarIdFromGoogleSubscription(item.subscriptionId)) ??
      [];
    if (calendarIds.length === 0) {
      return [] satisfies CalendarEventObject[];
    }

    const data = await this.fetchGoogleCalendarApi<{
      events?: GoogleCalendarEvent[];
    }>('/events', {
      body: JSON.stringify({ calendarIds, from, to }),
      method: 'POST',
      signal,
    });

    return (data.events ?? []).map(event => {
      const calendarId = event.calendarId;
      const eventId = event.iCalUID ?? event.id ?? crypto.randomUUID();
      const allDay = Boolean(event.start?.date || event.end?.date);
      const attendees =
        event.attendees
          ?.map(googleAttendeeLabel)
          .filter((name): name is string => !!name) ?? [];
      return {
        __typename: 'CalendarEventObjectType',
        id: `${GOOGLE_SUBSCRIPTION_PREFIX}${calendarId}:${eventId}`,
        subscriptionId: googleSubscriptionId(calendarId),
        externalEventId: eventId,
        recurrenceId: event.recurringEventId ?? null,
        status: event.status ?? null,
        title: event.summary ?? '',
        description: event.description ?? null,
        location: event.location ?? null,
        startAtUtc: googleDateToEventDate(event.start),
        endAtUtc: googleDateToEventDate(event.end),
        originalTimezone:
          event.start?.timeZone ??
          event.end?.timeZone ??
          event.calendarTimeZone ??
          null,
        allDay,
        attendees,
        calendarColor: event.calendarBackgroundColor ?? null,
        calendarName: event.calendarSummary ?? null,
        meetingUrl:
          googleConferenceUrl(event) ??
          extractMeetingUrl(event.htmlLink, event.location, event.description),
        notes: event.description ?? null,
        source: 'google',
        url: event.htmlLink,
      } as CalendarEventObject & {
        attendees?: string[];
        calendarColor?: string | null;
        calendarName?: string | null;
        meetingUrl?: string | null;
        notes?: string | null;
        source?: 'google';
        url?: string | null;
      };
    });
  }

  async fetchAccounts(
    signal?: AbortSignal
  ): Promise<CalendarAccountFetchResult> {
    const operations: {
      promise: Promise<CalendarAccount[] | CalendarAccount | null>;
      source: CalendarSource;
    }[] = [];
    const gql = this.gql;
    if (gql) {
      operations.push({
        promise: runRemoteCalendarQuery(
          querySignal =>
            gql({
              query: calendarAccountsQuery,
              context: { signal: querySignal },
            }),
          signal
        ).then(data => data.currentUser?.calendarAccounts ?? []),
        source: 'cloud',
      });
    }
    if (this.localCalendarHandler) {
      operations.push({
        promise: this.fetchLocalAccount(signal),
        source: 'eventkit',
      });
    }
    if (this.googleAuthService?.session.status$.value === 'connected') {
      operations.push({
        promise: runRemoteCalendarQuery(
          querySignal => this.fetchGoogleAccount(querySignal),
          signal
        ),
        source: 'google',
      });
    }

    const results = await Promise.allSettled(
      operations.map(operation => operation.promise)
    );
    const accounts: CalendarAccount[] = [];
    const errors: Error[] = [];
    const successfulSourceIds: CalendarSource[] = [];
    results.forEach((result, index) => {
      const operation = operations[index];
      if (!operation) {
        return;
      }
      if (result.status === 'rejected') {
        const error =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));
        errors.push(error);
        console.warn(
          `Failed to fetch ${operation.source} calendar accounts`,
          error
        );
        return;
      }

      successfulSourceIds.push(operation.source);
      if (Array.isArray(result.value)) {
        accounts.push(...result.value);
      } else if (result.value) {
        accounts.push(result.value);
      }
    });

    return {
      accounts,
      errors,
      successfulSourceIds,
      totalSources: operations.length,
    };
  }

  async fetchWorkspaceCalendars(
    signal?: AbortSignal
  ): Promise<WorkspaceCalendarFetchResult> {
    const operations: {
      nullIsSuccess: boolean;
      promise: Promise<WorkspaceCalendar[] | WorkspaceCalendar | null>;
      source: WorkspaceCalendarSource;
    }[] = [];
    const gql = this.gql;
    if (gql) {
      operations.push({
        nullIsSuccess: true,
        promise: runRemoteCalendarQuery(
          querySignal =>
            gql({
              query: workspaceCalendarsQuery,
              variables: { workspaceId: this.workspaceId },
              context: { signal: querySignal },
            }),
          signal
        ).then(data => data.workspace.calendars),
        source: 'cloud',
      });
    }
    if (this.localCalendarHandler) {
      operations.push({
        nullIsSuccess: false,
        promise: this.fetchLocalWorkspaceCalendar(signal),
        source: 'eventkit',
      });
    }
    if (this.googleAuthService?.session.status$.value === 'connected') {
      operations.push({
        nullIsSuccess: true,
        promise: runRemoteCalendarQuery(
          querySignal => this.fetchGoogleWorkspaceCalendar(querySignal),
          signal
        ),
        source: 'google',
      });
    }

    const results = await Promise.allSettled(
      operations.map(operation => operation.promise)
    );
    const calendars: WorkspaceCalendar[] = [];
    const errors: Error[] = [];
    const successfulSourceIds: WorkspaceCalendarSource[] = [];
    let successfulSources = 0;
    results.forEach((result, index) => {
      const operation = operations[index];
      if (!operation) {
        return;
      }
      if (result.status === 'rejected') {
        const error =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));
        errors.push(error);
        console.warn('Failed to fetch workspace calendar source', error);
        return;
      }
      if (Array.isArray(result.value)) {
        successfulSources += 1;
        successfulSourceIds.push(operation.source);
        calendars.push(...result.value);
      } else if (result.value) {
        successfulSources += 1;
        successfulSourceIds.push(operation.source);
        calendars.push(result.value);
      } else if (operation.nullIsSuccess) {
        successfulSources += 1;
        successfulSourceIds.push(operation.source);
      }
    });

    return {
      calendars,
      errors,
      successfulSourceIds,
      successfulSources,
      totalSources: operations.length,
    };
  }

  async updateWorkspaceCalendars(
    items: WorkspaceCalendarItemInput[]
  ): Promise<WorkspaceCalendarUpdateResult> {
    const selectedUserOwnedItems = items.filter(item =>
      isUserOwnedSubscriptionId(item.subscriptionId)
    );
    const hasSelectedLocalItems = items.some(item =>
      isLocalSubscriptionId(item.subscriptionId)
    );
    const hasLocalSource = hasSelectedLocalItems || !!this.localCalendarHandler;
    const hasSelectedGoogleItems = items.some(item =>
      isGoogleSubscriptionId(item.subscriptionId)
    );
    const savedSelection = this.readUserSelection();
    const hadSavedGoogleSource =
      savedSelection?.sourcePrefixes?.includes(GOOGLE_SUBSCRIPTION_PREFIX) ||
      savedSelection?.selectedIds.some(isGoogleSubscriptionId) ||
      false;
    const hasGoogleSource =
      hasSelectedGoogleItems ||
      hadSavedGoogleSource ||
      this.googleAuthService?.session.status$.value === 'connected';
    const cloudItems = items.filter(
      item => !isUserOwnedSubscriptionId(item.subscriptionId)
    );
    const gql = this.gql;
    let hasCloudSource = cloudItems.length > 0;
    if (gql && !hasCloudSource) {
      hasCloudSource = await runRemoteCalendarQuery(signal =>
        gql({
          query: calendarAccountsQuery,
          context: { signal },
        })
      )
        .then(data => (data.currentUser?.calendarAccounts ?? []).length > 0)
        .catch(error => {
          console.warn('Failed to detect cloud calendar accounts', error);
          // The update mutation is authoritative and can still clear a stale
          // cloud selection even when source discovery is unavailable.
          return true;
        });
    }

    const operations: {
      promise: Promise<WorkspaceCalendar | null>;
      sourcePrefix?: string;
    }[] = [];
    if (hasLocalSource) {
      operations.push({
        promise: this.updateLocalWorkspaceCalendars(items),
        sourcePrefix: LOCAL_SUBSCRIPTION_PREFIX,
      });
    }
    if (hasGoogleSource) {
      operations.push({
        promise: runRemoteCalendarQuery(signal =>
          this.updateGoogleWorkspaceCalendars(items, signal)
        ),
        sourcePrefix: GOOGLE_SUBSCRIPTION_PREFIX,
      });
    }
    if (gql && (hasCloudSource || operations.length === 0)) {
      operations.push({
        promise: runRemoteCalendarQuery(signal =>
          gql({
            query: updateWorkspaceCalendarsMutation,
            variables: {
              input: {
                workspaceId: this.workspaceId,
                items: cloudItems,
              },
            },
            context: { signal },
          })
        ).then(
          data =>
            data.updateWorkspaceCalendars satisfies UpdateWorkspaceCalendarsMutation['updateWorkspaceCalendars']
        ),
      });
    }

    if (operations.length === 0) {
      return {
        calendars: [],
        errors: [new Error('No calendar service available')],
      };
    }

    const results = await Promise.allSettled(
      operations.map(operation => operation.promise)
    );
    const calendars: WorkspaceCalendar[] = [];
    const errors: Error[] = [];
    const successfulSourcePrefixes: string[] = [];
    results.forEach((result, index) => {
      const operation = operations[index];
      if (result.status === 'rejected') {
        errors.push(
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason))
        );
        return;
      }
      if (result.value) {
        calendars.push(result.value);
      }
      if (operation?.sourcePrefix) {
        successfulSourcePrefixes.push(operation.sourcePrefix);
      }
    });
    this.updateUserSelectionForSources(
      selectedUserOwnedItems.map(item => item.subscriptionId),
      successfulSourcePrefixes
    );

    return { calendars, errors };
  }

  async fetchEvents(
    workspaceCalendarId: string,
    from: string,
    to: string,
    signal?: AbortSignal
  ) {
    if (workspaceCalendarId === LOCAL_WORKSPACE_CALENDAR_ID) {
      return this.fetchLocalEvents(workspaceCalendarId, from, to, signal);
    }
    if (workspaceCalendarId === GOOGLE_WORKSPACE_CALENDAR_ID) {
      return runRemoteCalendarQuery(
        querySignal =>
          this.fetchGoogleEvents(workspaceCalendarId, from, to, querySignal),
        signal
      );
    }

    const gql = this.gql;
    if (!gql)
      return [] satisfies CalendarEventsQuery['workspace']['calendars'][number]['events'];
    const data = await runRemoteCalendarQuery(
      querySignal =>
        gql({
          query: calendarEventsQuery,
          variables: {
            workspaceId: this.workspaceId,
            from,
            to,
          },
          context: { signal: querySignal },
        }),
      signal
    );
    const calendars = data.workspace.calendars;
    const calendar = calendars.find(item => item.id === workspaceCalendarId);
    return calendar?.events ?? [];
  }
}
