import { describe, expect, test, vi } from 'vitest';

import {
  fetchGoogleMeetingCalendarEvents,
  googleSessionAllowsCalendar,
  isGoogleSessionRevokedError,
  parseStoredGoogleSession,
  resolveGoogleCalendarSession,
  type StoredGoogleSession,
} from '../../src/main/windows-manager/google-calendar-scheduler';

const now = Date.parse('2026-07-16T14:00:00.000Z');

function session(
  tokens: Partial<StoredGoogleSession['tokens']> = {}
): StoredGoogleSession {
  return {
    tokens: {
      accessToken: 'access-token',
      expiresAt: now + 60 * 60 * 1000,
      refreshToken: 'refresh-token',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      ...tokens,
    },
    userInfo: {
      email: 'person@example.com',
      sub: 'user-1',
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('Google Calendar session', () => {
  test('parses the persisted shared session and verifies calendar scope', () => {
    const parsed = parseStoredGoogleSession(session());

    expect(parsed).toEqual(session());
    expect(googleSessionAllowsCalendar(parsed!)).toBe(true);
    expect(
      googleSessionAllowsCalendar(
        session({ scopes: ['https://www.googleapis.com/auth/drive.appdata'] })
      )
    ).toBe(false);
    expect(parseStoredGoogleSession({ tokens: {} })).toBeNull();
  });

  test('reuses a healthy access token without making a network request', async () => {
    const fetchFn = vi.fn();
    const stored = session();

    await expect(
      resolveGoogleCalendarSession({
        brokerUrl: '',
        clientId: '',
        fetchFn: fetchFn as typeof fetch,
        now,
        session: stored,
      })
    ).resolves.toBe(stored);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('refreshes an expired broker session without opening authorization', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        accessToken: 'fresh-access-token',
        expiresIn: 3600,
        refreshToken: 'rotated-refresh-token',
      })
    );

    const refreshed = await resolveGoogleCalendarSession({
      brokerUrl: 'https://thenota.app/',
      clientId: '',
      fetchFn: fetchFn as typeof fetch,
      now,
      session: session({
        authBrokerUrl: 'https://thenota.app',
        expiresAt: now - 1,
        refreshMode: 'broker',
      }),
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://thenota.app/api/google/refresh',
      expect.objectContaining({ method: 'POST' })
    );
    expect(refreshed.tokens).toMatchObject({
      accessToken: 'fresh-access-token',
      expiresAt: now + 3600 * 1000,
      refreshToken: 'rotated-refresh-token',
    });
  });

  test('never sends a refresh token to an insecure non-loopback broker', async () => {
    const fetchFn = vi.fn();

    await expect(
      resolveGoogleCalendarSession({
        brokerUrl: '',
        clientId: '',
        fetchFn: fetchFn as typeof fetch,
        now,
        session: session({
          authBrokerUrl: 'http://example.com',
          expiresAt: now - 1,
          refreshMode: 'broker',
        }),
      })
    ).rejects.toThrow('Google auth broker must use HTTPS.');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('refreshes an expired direct OAuth session with the desktop client ID', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ access_token: 'fresh-access-token', expires_in: 1800 })
    );

    const refreshed = await resolveGoogleCalendarSession({
      brokerUrl: '',
      clientId: 'desktop-client-id',
      fetchFn: fetchFn as typeof fetch,
      now,
      session: session({ expiresAt: now - 1, refreshMode: 'google' }),
    });

    const [, request] = fetchFn.mock.calls[0];
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://oauth2.googleapis.com/token'
    );
    expect(request?.body).toContain('client_id=desktop-client-id');
    expect(request?.body).toContain('grant_type=refresh_token');
    expect(refreshed.tokens.refreshToken).toBe('refresh-token');
  });

  test.each([
    [400, { error: 'invalid_grant' }],
    [400, { error: 'Invalid broker token' }],
    [401, { error: 'Unauthorized' }],
  ])(
    'classifies a revoked refresh session from HTTP %s',
    async (status, body) => {
      const fetchFn = vi.fn(async () => jsonResponse(body, status));

      const rejection = resolveGoogleCalendarSession({
        brokerUrl: 'https://thenota.app',
        clientId: '',
        fetchFn: fetchFn as typeof fetch,
        now,
        session: session({
          expiresAt: now - 1,
          refreshMode: 'broker',
        }),
      }).catch(error => error);

      await expect(rejection).resolves.toSatisfy(isGoogleSessionRevokedError);
    }
  );

  test('keeps transient refresh failures retryable', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: 'temporarily_unavailable' }, 503)
    );

    const rejection = resolveGoogleCalendarSession({
      brokerUrl: 'https://thenota.app',
      clientId: '',
      fetchFn: fetchFn as typeof fetch,
      now,
      session: session({
        expiresAt: now - 1,
        refreshMode: 'broker',
      }),
    }).catch(error => error);

    await expect(rejection).resolves.not.toSatisfy(isGoogleSessionRevokedError);
  });
});

test('loads and normalizes Google-only meeting events from every calendar', async () => {
  const calls: { init?: RequestInit; path: string }[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ init, path });
    if (path.endsWith('/calendars')) {
      return {
        calendars: [{ id: 'primary@example.com' }],
      } as T;
    }
    if (path.endsWith('/events')) {
      return {
        events: [
          {
            attendees: [{ email: 'teammate@example.com' }],
            calendarBackgroundColor: '#4285f4',
            calendarId: 'primary@example.com',
            calendarSummary: 'Work',
            end: { dateTime: '2026-07-16T14:30:00.000Z' },
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
            htmlLink: 'https://calendar.google.com/calendar/event?eid=abc',
            iCalUID: 'event-1@example.com',
            start: { dateTime: '2026-07-16T14:00:00.000Z' },
            status: 'confirmed',
            summary: 'Weekly planning',
          },
        ],
      } as T;
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const events = await fetchGoogleMeetingCalendarEvents({
    accessToken: 'access-token',
    from: '2026-07-16T13:55:00.000Z',
    request,
    to: '2026-07-16T22:00:00.000Z',
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    attendees: [{ email: 'teammate@example.com' }],
    calendarColor: '#4285f4',
    calendarName: 'Work',
    id: 'google:primary@example.com:event-1@example.com',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    source: 'google',
    title: 'Weekly planning',
  });
  expect(events[0].triggerId).toMatch(/^meeting-/);
  expect(calls.map(call => call.path)).toEqual([
    '/v1/google/calendar/calendars',
    '/v1/google/calendar/events',
  ]);
  expect(calls[1].init).toMatchObject({ method: 'POST' });
});

test('does not schedule a Google event declined by the signed-in user', async () => {
  const request = async <T>(path: string): Promise<T> => {
    if (path.endsWith('/calendars')) {
      return { calendars: [{ id: 'primary@example.com' }] } as T;
    }
    return {
      events: [
        {
          attendees: [
            {
              email: 'person@example.com',
              responseStatus: 'declined',
              self: true,
            },
            { email: 'teammate@example.com', responseStatus: 'accepted' },
          ],
          calendarId: 'primary@example.com',
          end: { dateTime: '2026-07-16T14:30:00.000Z' },
          hangoutLink: 'https://meet.google.com/abc-defg-hij',
          id: 'declined-event',
          start: { dateTime: '2026-07-16T14:00:00.000Z' },
          status: 'confirmed',
          summary: 'Declined meeting',
        },
      ],
    } as T;
  };

  await expect(
    fetchGoogleMeetingCalendarEvents({
      accessToken: 'access-token',
      from: '2026-07-16T13:55:00.000Z',
      request,
      to: '2026-07-16T22:00:00.000Z',
    })
  ).resolves.toEqual([]);
});

test('loads only explicitly selected Google calendars', async () => {
  const calls: { init?: RequestInit; path: string }[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ init, path });
    if (path.endsWith('/calendars')) {
      throw new Error(
        'Calendar discovery must not run for an explicit selection.'
      );
    }
    return { events: [] } as T;
  };

  await fetchGoogleMeetingCalendarEvents({
    accessToken: 'access-token',
    calendarIds: ['work@example.com', 'work@example.com'],
    from: '2026-07-16T13:55:00.000Z',
    request,
    to: '2026-07-16T22:00:00.000Z',
  });

  expect(calls.map(call => call.path)).toEqual(['/v1/google/calendar/events']);
  expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
    calendarIds: ['work@example.com'],
  });
});
