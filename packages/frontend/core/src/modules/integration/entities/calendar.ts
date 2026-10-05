import type {
  CalendarAccountsQuery,
  CalendarEventsQuery,
  WorkspaceCalendarItemInput,
  WorkspaceCalendarsQuery,
} from '@nota/graphql';
import {
  Entity,
  isCalendarEventCanceled,
  LiveData,
  normalizeCalendarEventStatus,
} from '@nota/infra';
import dayjs, { type Dayjs } from 'dayjs';

import type {
  CalendarSource,
  CalendarStore,
  WorkspaceCalendarSource,
} from '../store/calendar';
import type { CalendarEvent, LocalCalendarStatus } from '../type';

type CalendarEventObject =
  CalendarEventsQuery['workspace']['calendars'][number]['events'][number];
type CalendarAccountObject = NonNullable<
  CalendarAccountsQuery['currentUser']
>['calendarAccounts'][number];
type CalendarEventDetails = CalendarEventObject & {
  attendees?: string[];
  calendarColor?: string | null;
  calendarName?: string | null;
  meetingUrl?: string | null;
  notes?: string | null;
  source?: 'cloud' | 'eventkit' | 'google';
  url?: string | null;
};
type WorkspaceCalendarObject =
  WorkspaceCalendarsQuery['workspace']['calendars'][number];

const LOCAL_WORKSPACE_CALENDAR_ID = 'eventkit-workspace-calendar';
const GOOGLE_WORKSPACE_CALENDAR_ID = 'google-workspace-calendar';

function calendarAccountSource(account: CalendarAccountObject): CalendarSource {
  if (account.id === 'eventkit') {
    return 'eventkit';
  }
  if (account.id === 'google') {
    return 'google';
  }
  return 'cloud';
}

function mergeSuccessfulCalendarAccountSources(
  current: CalendarAccountObject[],
  updated: CalendarAccountObject[],
  successfulSources: CalendarSource[]
) {
  const sources = new Set(successfulSources);
  const updatedById = new Map(updated.map(account => [account.id, account]));
  const next: CalendarAccountObject[] = [];

  for (const account of current) {
    if (!sources.has(calendarAccountSource(account))) {
      next.push(account);
      continue;
    }

    const replacement = updatedById.get(account.id);
    if (replacement) {
      next.push(replacement);
      updatedById.delete(account.id);
    }
  }

  next.push(...updatedById.values());
  return next;
}

function workspaceCalendarSource(
  calendar: WorkspaceCalendarObject
): WorkspaceCalendarSource {
  if (calendar.id === LOCAL_WORKSPACE_CALENDAR_ID) {
    return 'eventkit';
  }
  if (calendar.id === GOOGLE_WORKSPACE_CALENDAR_ID) {
    return 'google';
  }
  return 'cloud';
}

function mergeSuccessfulWorkspaceCalendarSources(
  current: WorkspaceCalendarObject[],
  updated: WorkspaceCalendarObject[],
  successfulSources: WorkspaceCalendarSource[]
) {
  const sources = new Set(successfulSources);
  const updatedById = new Map(updated.map(calendar => [calendar.id, calendar]));
  const next: WorkspaceCalendarObject[] = [];

  for (const calendar of current) {
    if (!sources.has(workspaceCalendarSource(calendar))) {
      next.push(calendar);
      continue;
    }

    const replacement = updatedById.get(calendar.id);
    if (replacement) {
      next.push(replacement);
      updatedById.delete(calendar.id);
    }
  }

  next.push(...updatedById.values());
  return next;
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

function eventDetails(event: CalendarEventObject) {
  return event as CalendarEventDetails;
}

function normalizeDedupeText(value?: string | null) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDedupeUrl(value?: string | null) {
  const link = extractMeetingUrl(value);
  if (!link) return '';

  try {
    const url = new URL(link);
    return `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return link
      .toLowerCase()
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
}

function eventMeetingUrl(event: CalendarEventObject) {
  const details = eventDetails(event);
  return (
    details.meetingUrl ??
    extractMeetingUrl(
      details.url,
      event.location,
      details.notes,
      event.description
    )
  );
}

function eventMinuteKey(value?: string | null) {
  const parsed = dayjs(value);
  return parsed.isValid()
    ? String(Math.round(parsed.valueOf() / (1000 * 60)))
    : '';
}

function eventMinuteValue(value?: string | null) {
  const parsed = dayjs(value);
  return parsed.isValid() ? Math.round(parsed.valueOf() / (1000 * 60)) : null;
}

function eventDedupeKey(event: CalendarEventObject) {
  const meetingUrl = normalizeDedupeUrl(eventMeetingUrl(event));
  const startMinute = eventMinuteKey(event.startAtUtc);
  if (meetingUrl && startMinute) {
    return `meeting:${meetingUrl}:${startMinute}`;
  }

  const externalEventId = normalizeDedupeText(event.externalEventId);
  if (externalEventId && startMinute) {
    return `external:${externalEventId}:${startMinute}`;
  }

  const title = normalizeDedupeText(event.title);
  const location = normalizeDedupeUrl(event.location);
  return [
    'event',
    title,
    startMinute,
    eventMinuteKey(event.endAtUtc),
    event.allDay ? 'all-day' : 'timed',
    location,
  ].join(':');
}

function eventSource(event: CalendarEventObject) {
  return eventDetails(event).source ?? 'cloud';
}

function shouldRetainEventForFailedCalendars(
  event: CalendarEventObject,
  failedCalendarIds: Set<string>,
  workspaceCalendars: WorkspaceCalendarObject[]
) {
  const source = eventSource(event);
  if (source === 'eventkit' || source === 'google') {
    return workspaceCalendars.some(
      calendar =>
        failedCalendarIds.has(calendar.id) &&
        workspaceCalendarSource(calendar) === source
    );
  }

  const matchingCalendars = workspaceCalendars.filter(
    calendar =>
      workspaceCalendarSource(calendar) === 'cloud' &&
      calendar.items?.some(item => item.subscriptionId === event.subscriptionId)
  );
  if (matchingCalendars.length > 0) {
    return matchingCalendars.some(calendar =>
      failedCalendarIds.has(calendar.id)
    );
  }

  // Some legacy cloud payloads omit workspace items. Preserve their cached
  // events conservatively when any cloud source failed instead of making
  // meetings disappear during a transient refresh error.
  return workspaceCalendars.some(
    calendar =>
      failedCalendarIds.has(calendar.id) &&
      workspaceCalendarSource(calendar) === 'cloud'
  );
}

function eventsInRange(
  eventsByDateMap: Map<string, CalendarEventObject[]>,
  start: Dayjs,
  end: Dayjs
) {
  const events: CalendarEventObject[] = [];
  let cursor = start;
  while (cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) {
    events.push(...(eventsByDateMap.get(cursor.format('YYYY-MM-DD')) ?? []));
    cursor = cursor.add(1, 'day');
  }
  return events;
}

function eventExternalId(event: CalendarEventObject) {
  return normalizeDedupeText(event.externalEventId);
}

function eventTitle(event: CalendarEventObject) {
  return normalizeDedupeText(event.title);
}

function eventTimesAreClose(
  left: CalendarEventObject,
  right: CalendarEventObject
) {
  const leftStart = eventMinuteValue(left.startAtUtc);
  const rightStart = eventMinuteValue(right.startAtUtc);
  if (leftStart === null || rightStart === null) {
    return false;
  }
  if (Math.abs(leftStart - rightStart) > 5) {
    return false;
  }

  const leftEnd = eventMinuteValue(left.endAtUtc);
  const rightEnd = eventMinuteValue(right.endAtUtc);
  if (leftEnd === null || rightEnd === null) {
    return true;
  }
  return Math.abs(leftEnd - rightEnd) <= 10;
}

function titleTokens(value: string) {
  return value.split(' ').filter(token => token.length > 1);
}

function eventTitlesLookAlike(
  left: CalendarEventObject,
  right: CalendarEventObject
) {
  const leftTitle = eventTitle(left);
  const rightTitle = eventTitle(right);
  if (!leftTitle || !rightTitle) {
    return false;
  }
  if (leftTitle === rightTitle) {
    return true;
  }
  if (
    Math.min(leftTitle.length, rightTitle.length) >= 8 &&
    (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle))
  ) {
    return true;
  }

  const leftTokens = titleTokens(leftTitle);
  const rightTokens = titleTokens(rightTitle);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  const rightTokenSet = new Set(rightTokens);
  const shared = leftTokens.filter(token => rightTokenSet.has(token)).length;
  return shared / Math.min(leftTokens.length, rightTokens.length) >= 0.67;
}

function calendarNames(primary?: string | null, secondary?: string | null) {
  const names: string[] = [];
  for (const name of [primary, secondary]) {
    const trimmed = name?.trim();
    if (
      trimmed &&
      !names.some(
        existing =>
          normalizeDedupeText(existing) === normalizeDedupeText(trimmed)
      )
    ) {
      names.push(trimmed);
    }
  }
  return names;
}

function mergeAttendees(
  primary?: string[] | null,
  secondary?: string[] | null
) {
  const seen = new Set<string>();
  const attendees: string[] = [];
  for (const attendee of [...(primary ?? []), ...(secondary ?? [])]) {
    const key = normalizeDedupeText(attendee);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    attendees.push(attendee);
  }
  return attendees;
}

function eventPriority(event: CalendarEventObject) {
  const details = eventDetails(event);
  return (
    (details.source === 'eventkit' || details.source === 'google' ? 0 : 100) +
    (eventMeetingUrl(event) ? 20 : 0) +
    (details.attendees?.length ?? 0) +
    (details.notes || event.description ? 2 : 0) +
    (event.location ? 1 : 0)
  );
}

function mergeDuplicateEvents(
  current: CalendarEventObject,
  duplicate: CalendarEventObject
) {
  const primary =
    eventPriority(duplicate) > eventPriority(current) ? duplicate : current;
  const secondary = primary === duplicate ? current : duplicate;
  const primaryDetails = eventDetails(primary);
  const secondaryDetails = eventDetails(secondary);
  const attendees = mergeAttendees(
    primaryDetails.attendees,
    secondaryDetails.attendees
  );
  const names = calendarNames(
    primaryDetails.calendarName,
    secondaryDetails.calendarName
  );

  return {
    ...secondary,
    ...primary,
    title: primary.title || secondary.title,
    description: primary.description ?? secondary.description,
    location: primary.location ?? secondary.location,
    status: primary.status ?? secondary.status,
    attendees: attendees.length ? attendees : undefined,
    calendarColor:
      primaryDetails.calendarColor ?? secondaryDetails.calendarColor,
    calendarName:
      names.length > 1
        ? names.join(' / ')
        : (primaryDetails.calendarName ?? secondaryDetails.calendarName),
    meetingUrl:
      primaryDetails.meetingUrl ??
      secondaryDetails.meetingUrl ??
      eventMeetingUrl(primary) ??
      eventMeetingUrl(secondary),
    notes:
      primaryDetails.notes ??
      secondaryDetails.notes ??
      primary.description ??
      secondary.description,
    source: primaryDetails.source ?? secondaryDetails.source ?? 'cloud',
    url: primaryDetails.url ?? secondaryDetails.url,
  } satisfies CalendarEventDetails;
}

function shouldMergeCalendarEvents(
  current: CalendarEventObject,
  next: CalendarEventObject
) {
  if (eventDedupeKey(current) === eventDedupeKey(next)) {
    return true;
  }

  if (eventSource(current) === eventSource(next)) {
    return false;
  }

  if (!eventTimesAreClose(current, next)) {
    return false;
  }

  const currentUrl = normalizeDedupeUrl(eventMeetingUrl(current));
  const nextUrl = normalizeDedupeUrl(eventMeetingUrl(next));
  const currentExternalId = eventExternalId(current);
  const nextExternalId = eventExternalId(next);
  if (
    currentExternalId &&
    nextExternalId &&
    currentExternalId === nextExternalId
  ) {
    return true;
  }

  // Two explicit, different conference links identify different meetings even
  // when their titles and times happen to match. Keep the fuzzy title fallback
  // only for events where at least one source omitted the meeting URL.
  if (currentUrl && nextUrl) {
    return currentUrl === nextUrl;
  }

  return eventTitlesLookAlike(current, next);
}

function dedupeCalendarEvents(events: CalendarEventObject[]) {
  const deduped: CalendarEventObject[] = [];

  for (const rawEvent of events) {
    const status = normalizeCalendarEventStatus(rawEvent.status);
    if (isCalendarEventCanceled(status)) {
      continue;
    }
    const event = { ...rawEvent, status };
    const existingIndex = deduped.findIndex(current =>
      shouldMergeCalendarEvents(current, event)
    );
    if (existingIndex === -1) {
      deduped.push(event);
      continue;
    }

    deduped[existingIndex] = mergeDuplicateEvents(
      deduped[existingIndex],
      event
    );
  }

  return deduped;
}

export class CalendarIntegration extends Entity {
  constructor(private readonly store: CalendarStore) {
    super();
  }

  accounts$ = new LiveData<
    NonNullable<
      CalendarAccountsQuery['currentUser']
    >['calendarAccounts'][number][]
  >([]);
  accountCalendars$ = new LiveData<
    Map<
      string,
      NonNullable<
        NonNullable<
          CalendarAccountsQuery['currentUser']
        >['calendarAccounts'][number]
      >['calendars']
    >
  >(new Map());
  workspaceCalendars$ = new LiveData<
    WorkspaceCalendarsQuery['workspace']['calendars'][number][]
  >([]);
  localCalendarStatus$ = new LiveData<LocalCalendarStatus | null>(null);
  readonly eventsByDateMap$ = new LiveData<
    Map<
      string,
      CalendarEventsQuery['workspace']['calendars'][number]['events'][number][]
    >
  >(new Map());
  readonly eventDates$ = LiveData.computed(get => {
    const eventsByDateMap = get(this.eventsByDateMap$);
    const dates = new Set<string>();
    for (const [date, events] of eventsByDateMap) {
      if (events.length > 0) {
        dates.add(date);
      }
    }
    return dates;
  });

  private readonly subscriptionInfoById$ = LiveData.computed(get => {
    const accountCalendars = get(this.accountCalendars$);
    const workspaceCalendars = get(this.workspaceCalendars$);
    const subscriptionInfo = new Map<
      string,
      {
        subscription: NonNullable<
          NonNullable<
            CalendarAccountsQuery['currentUser']
          >['calendarAccounts'][number]
        >['calendars'][number];
        colorOverride?: string | null;
      }
    >();

    for (const calendars of accountCalendars.values()) {
      for (const calendar of calendars) {
        subscriptionInfo.set(calendar.id, { subscription: calendar });
      }
    }

    for (const workspaceCalendar of workspaceCalendars) {
      for (const item of workspaceCalendar.items ?? []) {
        const existing = subscriptionInfo.get(item.subscriptionId);
        if (!existing) continue;
        subscriptionInfo.set(item.subscriptionId, {
          ...existing,
          colorOverride: item.colorOverride,
        });
      }
    }

    return subscriptionInfo;
  });

  eventsByDate$(date: Dayjs) {
    const dateKey = date.format('YYYY-MM-DD');
    return LiveData.computed(get => {
      const subscriptionInfoById = get(this.subscriptionInfoById$);
      const eventsByDateMap = get(this.eventsByDateMap$);
      const events = eventsByDateMap.get(dateKey) ?? [];

      return events
        .map(event => {
          const eventDetails = event as typeof event & {
            attendees?: string[];
            calendarColor?: string | null;
            calendarName?: string | null;
            meetingUrl?: string | null;
            notes?: string | null;
            source?: 'eventkit' | 'google';
            url?: string | null;
          };
          const subscriptionInfo = subscriptionInfoById.get(
            event.subscriptionId
          );
          return {
            id: event.id,
            subscriptionId: event.subscriptionId,
            title: event.title ?? '',
            startAt: dayjs(event.startAtUtc),
            endAt: dayjs(event.endAtUtc),
            allDay: event.allDay,
            date,
            calendarName:
              eventDetails.calendarName ??
              subscriptionInfo?.subscription.displayName ??
              subscriptionInfo?.subscription.externalCalendarId ??
              '',
            calendarColor:
              eventDetails.calendarColor ??
              subscriptionInfo?.colorOverride ??
              subscriptionInfo?.subscription.color ??
              undefined,
            location: event.location,
            meetingUrl:
              eventDetails.meetingUrl ??
              extractMeetingUrl(
                eventDetails.url,
                event.location,
                eventDetails.notes,
                event.description
              ),
            notes: eventDetails.notes ?? event.description,
            url: eventDetails.url,
            attendees: eventDetails.attendees,
            source: eventDetails.source ?? 'cloud',
            status: event.status,
          } satisfies CalendarEvent;
        })
        .sort(
          (left, right) => left.startAt.valueOf() - right.startAt.valueOf()
        );
    });
  }

  async loadAccountCalendars(signal?: AbortSignal) {
    const { accounts, errors, successfulSourceIds } =
      await this.store.fetchAccounts(signal);
    const nextAccounts =
      errors.length === 0
        ? accounts
        : mergeSuccessfulCalendarAccountSources(
            this.accounts$.value,
            accounts,
            successfulSourceIds
          );
    this.accounts$.setValue(nextAccounts);

    const calendarsByAccount = new Map<
      string,
      NonNullable<
        NonNullable<
          CalendarAccountsQuery['currentUser']
        >['calendarAccounts'][number]
      >['calendars']
    >();

    nextAccounts.forEach(account => {
      calendarsByAccount.set(account.id, account.calendars ?? []);
    });

    this.accountCalendars$.setValue(calendarsByAccount);
    if (errors.length > 0) {
      throw new Error(
        `${successfulSourceIds.length === 0 ? 'Every' : 'Some'} calendar account source${successfulSourceIds.length === 0 ? '' : 's'} failed: ${errors
          .map(error => error.message)
          .join('; ')}`
      );
    }
    return calendarsByAccount;
  }

  async refreshLocalCalendarStatus() {
    const status = await this.store.fetchLocalCalendarStatus();
    this.localCalendarStatus$.setValue(status);
    return status;
  }

  async requestLocalCalendarAccess() {
    const status = await this.store.requestLocalCalendarAccess();
    this.localCalendarStatus$.setValue(status);
    return status;
  }

  async openLocalCalendarSettings() {
    return this.store.openLocalCalendarSettings();
  }

  async revalidateWorkspaceCalendars(signal?: AbortSignal) {
    const {
      calendars,
      errors,
      successfulSourceIds = [],
      successfulSources,
    } = await this.store.fetchWorkspaceCalendars(signal);
    if (errors.length > 0 && successfulSources === 0) {
      throw new Error(
        `Every workspace calendar source failed: ${errors
          .map(error => error.message)
          .join('; ')}`
      );
    }
    this.workspaceCalendars$.setValue(
      errors.length === 0
        ? calendars
        : mergeSuccessfulWorkspaceCalendarSources(
            this.workspaceCalendars$.value,
            calendars,
            successfulSourceIds
          )
    );
    if (errors.length > 0) {
      throw new Error(
        `Some workspace calendar sources failed: ${errors
          .map(error => error.message)
          .join('; ')}`
      );
    }
    return this.workspaceCalendars$.value;
  }

  async updateWorkspaceCalendars(items: WorkspaceCalendarItemInput[]) {
    const { calendars: updatedCalendars, errors } =
      await this.store.updateWorkspaceCalendars(items);
    const next = [...this.workspaceCalendars$.value];
    for (const calendar of updatedCalendars) {
      const index = next.findIndex(item => item.id === calendar.id);
      if (index >= 0) {
        next[index] = calendar;
      } else {
        next.push(calendar);
      }
    }
    this.workspaceCalendars$.setValue(next);
    if (errors.length > 0) {
      throw new Error(
        `Some calendar sources could not be saved: ${errors
          .map(error => error.message)
          .join('; ')}`
      );
    }
    return updatedCalendars;
  }

  async revalidateEventsRange(
    rangeStart: Dayjs,
    rangeEnd: Dayjs,
    signal?: AbortSignal
  ) {
    const start = rangeStart.startOf('day');
    const end = rangeEnd.endOf('day');
    const workspaceCalendars = this.workspaceCalendars$.value.filter(
      calendar => calendar.enabled
    );
    const next = new Map(this.eventsByDateMap$.value);
    let cursor = start;
    while (cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) {
      next.set(cursor.format('YYYY-MM-DD'), []);
      cursor = cursor.add(1, 'day');
    }
    if (workspaceCalendars.length === 0) {
      this.eventsByDateMap$.setValue(next);
      return { events: [], failedSources: 0, totalSources: 0 };
    }

    const eventResults = await Promise.allSettled(
      workspaceCalendars.map(calendar =>
        this.store.fetchEvents(
          calendar.id,
          start.toISOString(),
          end.toISOString(),
          signal
        )
      )
    );
    const failedResults = eventResults.filter(
      result => result.status === 'rejected'
    );
    if (failedResults.length === eventResults.length) {
      const reasons = failedResults
        .map(result => String(result.reason))
        .join('; ');
      throw new Error(`All calendar sources failed to refresh: ${reasons}`);
    }
    const failedCalendarIds = new Set<string>();
    eventResults.forEach((result, index) => {
      if (result.status !== 'rejected') {
        return;
      }
      const calendar = workspaceCalendars[index];
      if (calendar) {
        failedCalendarIds.add(calendar.id);
      }
      console.warn('Failed to fetch calendar events', result.reason);
    });
    const successfulEvents = eventResults.flatMap(result =>
      result.status === 'fulfilled' ? result.value : []
    );
    const successfulCancellations = successfulEvents.filter(event =>
      isCalendarEventCanceled(event.status)
    );
    const retainedEvents =
      failedCalendarIds.size > 0
        ? eventsInRange(this.eventsByDateMap$.value, start, end)
            .filter(event =>
              shouldRetainEventForFailedCalendars(
                event,
                failedCalendarIds,
                workspaceCalendars
              )
            )
            .filter(
              event =>
                !successfulCancellations.some(cancellation =>
                  shouldMergeCalendarEvents(event, cancellation)
                )
            )
        : [];
    const events = dedupeCalendarEvents(
      retainedEvents.concat(successfulEvents)
    );
    for (const event of events) {
      const startAt = dayjs(event.startAtUtc);
      const endAt = dayjs(event.endAtUtc);
      let current = startAt.isBefore(start, 'day') ? start : startAt;
      const rangeEndDay = endAt.isAfter(end, 'day') ? end : endAt;

      while (
        current.isBefore(rangeEndDay, 'day') ||
        current.isSame(rangeEndDay, 'day')
      ) {
        if (
          current.isSame(endAt, 'day') &&
          endAt.hour() === 0 &&
          endAt.minute() === 0
        ) {
          break;
        }
        const dateKey = current.format('YYYY-MM-DD');
        const list = next.get(dateKey);
        if (list) {
          list.push(event);
        } else {
          next.set(dateKey, [event]);
        }
        current = current.add(1, 'day');
      }
    }
    this.eventsByDateMap$.setValue(next);
    return {
      events,
      failedSources: failedResults.length,
      totalSources: eventResults.length,
    };
  }

  async revalidateEvents(date: Dayjs, signal?: AbortSignal) {
    return await this.revalidateEventsRange(date, date, signal);
  }
}
