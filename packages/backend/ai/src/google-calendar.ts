import type { Express, Request } from 'express';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

type GoogleCalendarListEntry = {
  accessRole?: string;
  backgroundColor?: string;
  description?: string;
  id?: string;
  primary?: boolean;
  selected?: boolean;
  summary?: string;
  timeZone?: string;
};

type GoogleCalendarEvent = {
  attendees?: {
    displayName?: string;
    email?: string;
    responseStatus?: string;
    self?: boolean;
  }[];
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
  created?: string;
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
  updated?: string;
};

type GoogleCalendarEventsRequest = {
  calendarIds?: unknown;
  from?: unknown;
  to?: unknown;
};

function readBearerToken(req: Request) {
  const authorization = req.header('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error('Missing Google access token');
  }
  return match[1].trim();
}

async function fetchGoogleJson<T>(
  accessToken: string,
  path: string,
  searchParams?: URLSearchParams
) {
  const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
  if (searchParams) {
    for (const [key, value] of searchParams) {
      url.searchParams.append(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : `Google Calendar API failed with HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data as T;
}

async function listAllPages<TItem>(input: {
  accessToken: string;
  itemsKey?: string;
  path: string;
  searchParams: URLSearchParams;
}) {
  const items: TItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams(input.searchParams);
    if (pageToken) params.set('pageToken', pageToken);
    const data = await fetchGoogleJson<{
      items?: TItem[];
      nextPageToken?: string;
    }>(input.accessToken, input.path, params);
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

async function listCalendars(accessToken: string) {
  return listAllPages<GoogleCalendarListEntry>({
    accessToken,
    path: '/users/me/calendarList',
    searchParams: new URLSearchParams({
      fields:
        'items(id,summary,description,backgroundColor,timeZone,selected,primary,accessRole),nextPageToken',
      minAccessRole: 'reader',
      showDeleted: 'false',
      showHidden: 'false',
    }),
  });
}

async function listCalendarEvents(input: {
  accessToken: string;
  calendar: GoogleCalendarListEntry;
  from: string;
  to: string;
}) {
  if (!input.calendar.id) return [];
  const events = await listAllPages<Omit<GoogleCalendarEvent, 'calendarId'>>({
    accessToken: input.accessToken,
    path: `/calendars/${encodeURIComponent(input.calendar.id)}/events`,
    searchParams: new URLSearchParams({
      fields:
        'items(id,iCalUID,status,summary,description,location,start,end,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(email,displayName,responseStatus,self),organizer(email,displayName,self),recurringEventId,created,updated),nextPageToken',
      maxResults: '2500',
      orderBy: 'startTime',
      showDeleted: 'false',
      singleEvents: 'true',
      timeMax: input.to,
      timeMin: input.from,
    }),
  });

  return events.map(event => ({
    ...event,
    calendarBackgroundColor: input.calendar.backgroundColor,
    calendarId: input.calendar.id ?? '',
    calendarSummary: input.calendar.summary,
    calendarTimeZone: input.calendar.timeZone,
  }));
}

function readEventsRequest(body: GoogleCalendarEventsRequest) {
  const calendarIds = Array.isArray(body.calendarIds)
    ? body.calendarIds.filter(
        (calendarId): calendarId is string =>
          typeof calendarId === 'string' && calendarId.length > 0
      )
    : [];
  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';

  if (calendarIds.length === 0) {
    throw new Error('calendarIds must include at least one calendar ID');
  }
  if (!from || !to) {
    throw new Error('from and to are required');
  }

  return { calendarIds, from, to };
}

export function registerGoogleCalendarRoutes(app: Express) {
  app.get('/v1/google/calendar/calendars', async (req, res) => {
    try {
      const accessToken = readBearerToken(req);
      const calendars = await listCalendars(accessToken);
      res.json({ calendars });
    } catch (error) {
      res.status((error as { status?: number }).status ?? 400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/v1/google/calendar/events', async (req, res) => {
    try {
      const accessToken = readBearerToken(req);
      const { calendarIds, from, to } = readEventsRequest(req.body ?? {});
      const calendars = await listCalendars(accessToken);
      const calendarsById = new Map(
        calendars
          .filter(calendar => calendar.id && calendarIds.includes(calendar.id))
          .map(calendar => [calendar.id, calendar])
      );
      const events = (
        await Promise.all(
          calendarIds.map(calendarId =>
            listCalendarEvents({
              accessToken,
              calendar: calendarsById.get(calendarId) ?? { id: calendarId },
              from,
              to,
            })
          )
        )
      ).flat();

      res.json({ events });
    } catch (error) {
      res.status((error as { status?: number }).status ?? 400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
