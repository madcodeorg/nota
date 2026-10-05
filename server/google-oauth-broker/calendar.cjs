const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function readBearerToken(req) {
  const authorization = req.headers.authorization || '';
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new Error('Missing Google access token');
  }
  return match[1].trim();
}

async function fetchGoogleJson(accessToken, path, searchParams) {
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
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function listAllPages(input) {
  const items = [];
  let pageToken;

  do {
    const params = new URLSearchParams(input.searchParams);
    if (pageToken) params.set('pageToken', pageToken);
    const data = await fetchGoogleJson(input.accessToken, input.path, params);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

async function listCalendars(accessToken) {
  return listAllPages({
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

async function listCalendarEvents(input) {
  if (!input.calendar.id) return [];
  const events = await listAllPages({
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
    calendarId: input.calendar.id || '',
    calendarSummary: input.calendar.summary,
    calendarTimeZone: input.calendar.timeZone,
  }));
}

function readEventsRequest(body) {
  const calendarIds = Array.isArray(body?.calendarIds)
    ? body.calendarIds.filter(
        calendarId => typeof calendarId === 'string' && calendarId.length > 0
      )
    : [];
  const from = typeof body?.from === 'string' ? body.from : '';
  const to = typeof body?.to === 'string' ? body.to : '';

  if (calendarIds.length === 0) {
    throw new Error('calendarIds must include at least one calendar ID');
  }
  if (!from || !to) {
    throw new Error('from and to are required');
  }

  return { calendarIds, from, to };
}

async function listEventsForCalendars(accessToken, body) {
  const { calendarIds, from, to } = readEventsRequest(body);
  const calendars = await listCalendars(accessToken);
  const calendarsById = new Map(
    calendars
      .filter(calendar => calendar.id && calendarIds.includes(calendar.id))
      .map(calendar => [calendar.id, calendar])
  );
  return (
    await Promise.all(
      calendarIds.map(calendarId =>
        listCalendarEvents({
          accessToken,
          calendar: calendarsById.get(calendarId) || { id: calendarId },
          from,
          to,
        })
      )
    )
  ).flat();
}

module.exports = {
  listCalendars,
  listEventsForCalendars,
  readBearerToken,
};
