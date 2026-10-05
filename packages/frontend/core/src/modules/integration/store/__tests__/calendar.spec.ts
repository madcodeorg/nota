/**
 * @vitest-environment happy-dom
 */

import { Framework } from '@nota/infra';
import dayjs from 'dayjs';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { WorkspaceServerService } from '../../../cloud';
import { DesktopApiService } from '../../../desktop-api';
import { GoogleAuthService } from '../../../google-auth';
import { WorkspaceService } from '../../../workspace';
import { CalendarIntegration } from '../../entities/calendar';
import { CalendarStore } from '../calendar';

const localCalendars = [{ id: 'local-calendar', title: 'Personal' }];

function createCalendarStore({
  calendars = localCalendars,
  events = [],
  gql,
  googleAuth,
}: {
  calendars?: unknown;
  events?: unknown;
  gql?: (request: any) => Promise<any>;
  googleAuth?: unknown;
} = {}) {
  const calendarHandler = {
    getLocalCalendarStatus: vi.fn().mockResolvedValue({
      authorized: true,
      supported: true,
    }),
    listLocalCalendarEvents: vi.fn().mockResolvedValue(events),
    listLocalCalendars: vi.fn().mockResolvedValue(calendars),
  };
  const framework = new Framework();
  framework.service(WorkspaceService, {
    workspace: { id: 'workspace-1' },
  } as any);
  framework.service(WorkspaceServerService, {
    server: gql ? { gql } : null,
  } as any);
  framework.service(DesktopApiService, {
    handler: { calendar: calendarHandler },
  } as any);
  if (googleAuth) {
    framework.service(GoogleAuthService, googleAuth as any);
  }
  framework.store(CalendarStore, [WorkspaceService, WorkspaceServerService]);

  return {
    calendarHandler,
    store: framework.provider().get(CalendarStore),
  };
}

function createCalendarIntegration(store: unknown) {
  const framework = new Framework();
  framework.store(CalendarStore, store as any);
  framework.entity(CalendarIntegration, [CalendarStore]);
  return framework.provider().get(CalendarIntegration);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('CalendarStore', () => {
  test('fetchAccounts returns local calendars after the cloud query timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let querySignal: AbortSignal | undefined;
    const gql = vi.fn((request: any) => {
      querySignal = request.context.signal;
      return new Promise<never>(() => {});
    });
    const { calendarHandler, store } = createCalendarStore({ gql });

    const resultPromise = store.fetchAccounts();
    await vi.advanceTimersByTimeAsync(0);

    expect(calendarHandler.listLocalCalendars).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2500);

    await expect(resultPromise).resolves.toMatchObject({
      accounts: [{ id: 'eventkit' }],
      errors: [{ message: 'Remote calendar query timed out' }],
      successfulSourceIds: ['eventkit'],
      totalSources: 2,
    });
    expect(querySignal?.aborted).toBe(true);
  });

  test('fetchWorkspaceCalendars returns local calendars after the cloud query timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let querySignal: AbortSignal | undefined;
    const gql = vi.fn((request: any) => {
      querySignal = request.context.signal;
      return new Promise<never>(() => {});
    });
    const { calendarHandler, store } = createCalendarStore({ gql });

    const resultPromise = store.fetchWorkspaceCalendars();
    await vi.advanceTimersByTimeAsync(0);

    expect(calendarHandler.listLocalCalendars).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2500);

    await expect(resultPromise).resolves.toMatchObject({
      calendars: [{ id: 'eventkit-workspace-calendar' }],
      errors: [{ message: 'Remote calendar query timed out' }],
      successfulSourceIds: ['eventkit'],
      successfulSources: 1,
      totalSources: 2,
    });
    expect(querySignal?.aborted).toBe(true);
  });

  test('does not count unavailable EventKit as success when cloud refresh fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gql = vi.fn(() => new Promise<never>(() => {}));
    const { calendarHandler, store } = createCalendarStore({ gql });
    calendarHandler.getLocalCalendarStatus.mockResolvedValue({
      authorized: false,
      supported: true,
    });

    const resultPromise = store.fetchWorkspaceCalendars();
    await vi.advanceTimersByTimeAsync(2500);

    await expect(resultPromise).resolves.toMatchObject({
      calendars: [],
      errors: [{ message: 'Remote calendar query timed out' }],
      successfulSources: 0,
      totalSources: 2,
    });
  });

  test('keeps an empty successful source distinct from a failed source', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gql = vi.fn().mockResolvedValue({
      workspace: { calendars: [] },
    });
    const { calendarHandler, store } = createCalendarStore({
      calendars: [],
      gql,
    });
    calendarHandler.listLocalCalendars.mockRejectedValue(
      new Error('EventKit unavailable')
    );

    await expect(store.fetchWorkspaceCalendars()).resolves.toMatchObject({
      calendars: [],
      errors: [{ message: 'EventKit unavailable' }],
      successfulSourceIds: ['cloud'],
      successfulSources: 1,
      totalSources: 2,
    });
  });

  test('preserves timely cloud results alongside local calendars', async () => {
    const cloudAccount = { calendars: [], id: 'cloud-account' };
    const gql = vi.fn().mockResolvedValue({
      currentUser: { calendarAccounts: [cloudAccount] },
    });
    const { store } = createCalendarStore({ gql });

    const { accounts } = await store.fetchAccounts();

    expect(accounts.map(account => account.id)).toEqual([
      'cloud-account',
      'eventkit',
    ]);
  });

  test('bounds a stalled cloud event query', async () => {
    vi.useFakeTimers();
    let querySignal: AbortSignal | undefined;
    const gql = vi.fn((request: any) => {
      querySignal = request.context.signal;
      return new Promise<never>(() => {});
    });
    const { store } = createCalendarStore({ gql });

    const resultPromise = store.fetchEvents(
      'cloud-workspace-calendar',
      '2026-07-10T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z'
    );
    const rejection = expect(resultPromise).rejects.toThrow(
      'Remote calendar query timed out'
    );
    await vi.advanceTimersByTimeAsync(2500);

    await rejection;
    expect(querySignal?.aborted).toBe(true);
  });

  test('bounds stalled Google token loading without blocking local calendars', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getAccessToken = vi.fn(() => new Promise<never>(() => {}));
    const { store } = createCalendarStore({
      googleAuth: {
        session: {
          getAccessToken,
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          status$: { value: 'connected' },
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          userInfo$: {
            value: {
              email: 'calendar@example.com',
              name: 'Calendar User',
              sub: 'google-user',
            },
          },
        },
      },
    });

    const resultPromise = store.fetchAccounts();
    await vi.advanceTimersByTimeAsync(2500);

    await expect(resultPromise).resolves.toMatchObject({
      accounts: [{ id: 'eventkit' }],
      errors: [{ message: 'Remote calendar query timed out' }],
      successfulSourceIds: ['eventkit'],
      totalSources: 2,
    });
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  test('bounds a stalled Google calendar update', async () => {
    vi.useFakeTimers();
    const getAccessToken = vi.fn(() => new Promise<never>(() => {}));
    const { store } = createCalendarStore({
      calendars: [],
      googleAuth: {
        session: {
          getAccessToken,
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          status$: { value: 'connected' },
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          userInfo$: {
            value: {
              email: 'calendar@example.com',
              name: 'Calendar User',
              sub: 'google-user',
            },
          },
        },
      },
    });

    const updatePromise = store.updateWorkspaceCalendars([
      { subscriptionId: 'google:calendar-1' } as any,
    ]);
    await vi.advanceTimersByTimeAsync(2500);

    await expect(updatePromise).resolves.toMatchObject({
      calendars: [],
      errors: [{ message: 'Remote calendar query timed out' }],
    });
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'nota:user-calendar-selection:workspace-1'
        ) ?? '{}'
      )
    ).toMatchObject({
      selectedIds: [],
      sourcePrefixes: ['eventkit:'],
    });
  });

  test('applies local selection when a cloud update times out', async () => {
    vi.useFakeTimers();
    let mutationSignal: AbortSignal | undefined;
    const gql = vi.fn((request: any) => {
      mutationSignal = request.context.signal;
      return new Promise<never>(() => {});
    });
    const { store } = createCalendarStore({ gql });

    const updatePromise = store.updateWorkspaceCalendars([
      { subscriptionId: 'eventkit:local-calendar' } as any,
      { subscriptionId: 'cloud-calendar-1' } as any,
    ]);
    await vi.advanceTimersByTimeAsync(2500);

    await expect(updatePromise).resolves.toMatchObject({
      calendars: [{ id: 'eventkit-workspace-calendar' }],
      errors: [{ message: 'Remote calendar query timed out' }],
    });
    expect(gql).toHaveBeenCalledOnce();
    expect(mutationSignal?.aborted).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'nota:user-calendar-selection:workspace-1'
        ) ?? '{}'
      )
    ).toMatchObject({
      selectedIds: ['eventkit:local-calendar'],
      sourcePrefixes: ['eventkit:'],
    });
  });

  test('applies cloud update without persisting a timed-out Google selection', async () => {
    vi.useFakeTimers();
    const getAccessToken = vi.fn(() => new Promise<never>(() => {}));
    const gql = vi.fn().mockResolvedValue({
      updateWorkspaceCalendars: {
        id: 'cloud-workspace-calendar',
        items: [],
      },
    });
    const { store } = createCalendarStore({
      calendars: [],
      gql,
      googleAuth: {
        session: {
          getAccessToken,
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          status$: { value: 'connected' },
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          userInfo$: {
            value: {
              email: 'calendar@example.com',
              name: 'Calendar User',
              sub: 'google-user',
            },
          },
        },
      },
    });

    const updatePromise = store.updateWorkspaceCalendars([
      { subscriptionId: 'google:calendar-1' } as any,
      { subscriptionId: 'cloud-calendar-1' } as any,
    ]);
    await vi.advanceTimersByTimeAsync(2500);

    await expect(updatePromise).resolves.toMatchObject({
      calendars: [{ id: 'cloud-workspace-calendar' }],
      errors: [{ message: 'Remote calendar query timed out' }],
    });
    expect(gql).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'nota:user-calendar-selection:workspace-1'
        ) ?? '{}'
      )
    ).toMatchObject({
      selectedIds: [],
      sourcePrefixes: ['eventkit:'],
    });
  });

  test('preserves a failed source selection while persisting a successful source', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      'nota:user-calendar-selection:workspace-1',
      JSON.stringify({
        selectedIds: ['google:previous-calendar'],
        sourcePrefixes: ['google:'],
      })
    );
    const getAccessToken = vi.fn(() => new Promise<never>(() => {}));
    const { store } = createCalendarStore({
      googleAuth: {
        session: {
          getAccessToken,
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          status$: { value: 'connected' },
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          userInfo$: {
            value: {
              email: 'calendar@example.com',
              name: 'Calendar User',
              sub: 'google-user',
            },
          },
        },
      },
    });

    const updatePromise = store.updateWorkspaceCalendars([
      { subscriptionId: 'eventkit:local-calendar' } as any,
      { subscriptionId: 'google:new-calendar' } as any,
    ]);
    await vi.advanceTimersByTimeAsync(2500);
    await updatePromise;

    expect(
      JSON.parse(
        window.localStorage.getItem(
          'nota:user-calendar-selection:workspace-1'
        ) ?? '{}'
      )
    ).toMatchObject({
      selectedIds: ['google:previous-calendar', 'eventkit:local-calendar'],
      sourcePrefixes: ['google:', 'eventkit:'],
    });
  });

  test('deselect-all preserves Google selection when its update times out', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      'nota:user-calendar-selection:workspace-1',
      JSON.stringify({
        selectedIds: ['google:previous-calendar'],
        sourcePrefixes: ['google:'],
      })
    );
    const getAccessToken = vi.fn(() => new Promise<never>(() => {}));
    const { store } = createCalendarStore({
      googleAuth: {
        session: {
          getAccessToken,
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          status$: { value: 'connected' },
          // eslint-disable-next-line rxjs/finnish -- mirrors GoogleAuthSession
          userInfo$: { value: null },
        },
      },
    });

    const updatePromise = store.updateWorkspaceCalendars([]);
    await vi.advanceTimersByTimeAsync(2500);

    await expect(updatePromise).resolves.toMatchObject({
      errors: [{ message: 'Remote calendar query timed out' }],
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'nota:user-calendar-selection:workspace-1'
        ) ?? '{}'
      )
    ).toMatchObject({
      selectedIds: ['google:previous-calendar'],
      sourcePrefixes: ['google:', 'eventkit:'],
    });
  });

  test('deselect-all preserves local selection when EventKit update fails', async () => {
    window.localStorage.setItem(
      'nota:user-calendar-selection:workspace-1',
      JSON.stringify({
        selectedIds: ['eventkit:local-calendar'],
        sourcePrefixes: ['eventkit:'],
      })
    );
    const { calendarHandler, store } = createCalendarStore();
    calendarHandler.listLocalCalendars.mockRejectedValue(
      new Error('EventKit unavailable')
    );

    await expect(store.updateWorkspaceCalendars([])).resolves.toMatchObject({
      calendars: [],
      errors: [{ message: 'EventKit unavailable' }],
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'nota:user-calendar-selection:workspace-1'
        ) ?? '{}'
      )
    ).toMatchObject({
      selectedIds: ['eventkit:local-calendar'],
      sourcePrefixes: ['eventkit:'],
    });
  });

  test('deselect-all still runs cloud clearing mutation after discovery timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gql = vi
      .fn()
      .mockImplementationOnce(() => new Promise<never>(() => {}))
      .mockResolvedValueOnce({
        updateWorkspaceCalendars: {
          id: 'cloud-workspace-calendar',
          items: [],
        },
      });
    const { store } = createCalendarStore({ gql });

    const updatePromise = store.updateWorkspaceCalendars([]);
    await vi.advanceTimersByTimeAsync(2500);

    await expect(updatePromise).resolves.toMatchObject({
      calendars: [
        { id: 'eventkit-workspace-calendar', items: [] },
        { id: 'cloud-workspace-calendar', items: [] },
      ],
      errors: [],
    });
    expect(gql).toHaveBeenCalledTimes(2);
  });

  test.each([null, { unexpected: true }])(
    'normalizes non-array local calendar IPC result %o',
    async calendars => {
      const { store } = createCalendarStore({ calendars });

      await expect(store.fetchAccounts()).resolves.toMatchObject({
        accounts: [],
        errors: [],
        successfulSourceIds: ['eventkit'],
        totalSources: 1,
      });
    }
  );

  test.each([null, { unexpected: true }])(
    'normalizes non-array local event IPC result %o',
    async events => {
      const { store } = createCalendarStore({ events });

      await expect(
        store.fetchEvents(
          'eventkit-workspace-calendar',
          '2026-07-10T00:00:00.000Z',
          '2026-07-11T00:00:00.000Z'
        )
      ).resolves.toEqual([]);
    }
  );
});

describe('CalendarIntegration', () => {
  test('updates successful account sources while retaining failed source metadata', async () => {
    const appleAccount = {
      calendars: [{ id: 'eventkit:new', displayName: 'Work' }],
      id: 'eventkit',
    } as any;
    const googleAccount = {
      calendars: [{ id: 'google:cached', displayName: 'Team' }],
      id: 'google',
    } as any;
    const store = {
      fetchAccounts: vi.fn().mockResolvedValue({
        accounts: [appleAccount],
        errors: [new Error('Google timed out')],
        successfulSourceIds: ['eventkit'],
        totalSources: 2,
      }),
    };
    const calendar = createCalendarIntegration(store);
    calendar.accounts$.setValue([
      {
        calendars: [{ id: 'eventkit:old', displayName: 'Old Apple' }],
        id: 'eventkit',
      } as any,
      googleAccount,
    ]);

    await expect(calendar.loadAccountCalendars()).rejects.toThrow(
      'Some calendar account sources failed'
    );

    expect(calendar.accounts$.value).toEqual([appleAccount, googleAccount]);
    expect(calendar.accountCalendars$.value.get('eventkit')).toMatchObject([
      { id: 'eventkit:new' },
    ]);
    expect(calendar.accountCalendars$.value.get('google')).toMatchObject([
      { id: 'google:cached' },
    ]);
  });

  test('replaces an empty successful source while retaining a failed source', async () => {
    const store = {
      fetchWorkspaceCalendars: vi.fn().mockResolvedValue({
        calendars: [],
        errors: [new Error('EventKit unavailable')],
        successfulSourceIds: ['cloud'],
        successfulSources: 1,
        totalSources: 2,
      }),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      {
        enabled: true,
        id: 'eventkit-workspace-calendar',
        items: [{ subscriptionId: 'eventkit:personal' }],
      } as any,
      { enabled: true, id: 'stale-cloud', items: [] } as any,
    ]);

    await expect(calendar.revalidateWorkspaceCalendars()).rejects.toThrow(
      'Some workspace calendar sources failed'
    );
    expect(calendar.workspaceCalendars$.value).toMatchObject([
      { id: 'eventkit-workspace-calendar' },
    ]);
  });

  test('preserves workspace calendars when every source fails', async () => {
    const staleCalendar = { enabled: true, id: 'stale', items: [] } as any;
    const store = {
      fetchWorkspaceCalendars: vi.fn().mockResolvedValue({
        calendars: [],
        errors: [new Error('EventKit unavailable')],
        successfulSourceIds: [],
        successfulSources: 0,
        totalSources: 1,
      }),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([staleCalendar]);

    await expect(calendar.revalidateWorkspaceCalendars()).rejects.toThrow(
      'Every workspace calendar source failed'
    );
    expect(calendar.workspaceCalendars$.value).toEqual([staleCalendar]);
  });

  test('merges successful updates before reporting a partial save error', async () => {
    const store = {
      updateWorkspaceCalendars: vi.fn().mockResolvedValue({
        calendars: [{ enabled: true, id: 'apple', items: [{ id: 'new' }] }],
        errors: [new Error('Google timed out')],
      }),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      { enabled: true, id: 'apple', items: [{ id: 'old' }] } as any,
      { enabled: true, id: 'google', items: [{ id: 'kept' }] } as any,
    ]);

    await expect(calendar.updateWorkspaceCalendars([])).rejects.toThrow(
      'Some calendar sources could not be saved'
    );
    expect(calendar.workspaceCalendars$.value).toMatchObject([
      { id: 'apple', items: [{ id: 'new' }] },
      { id: 'google', items: [{ id: 'kept' }] },
    ]);
  });

  test('reports an error when every calendar source fails', async () => {
    const store = {
      fetchEvents: vi.fn().mockRejectedValue(new Error('source unavailable')),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      { enabled: true, id: 'calendar-1', items: [] } as any,
      { enabled: true, id: 'calendar-2', items: [] } as any,
    ]);

    await expect(
      calendar.revalidateEvents(dayjs('2026-07-10'))
    ).rejects.toThrow('All calendar sources failed to refresh');
  });

  test('publishes fresh events while retaining the failed source events', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event = {
      __typename: 'CalendarEventObjectType' as const,
      allDay: false,
      description: null,
      endAtUtc: '2026-07-10T15:00:00.000Z',
      externalEventId: 'event-1',
      id: 'event-1',
      location: null,
      originalTimezone: 'UTC',
      recurrenceId: null,
      startAtUtc: '2026-07-10T14:00:00.000Z',
      status: null,
      subscriptionId: 'subscription-1',
      title: 'Project review',
    };
    const store = {
      fetchEvents: vi
        .fn()
        .mockResolvedValueOnce([event])
        .mockRejectedValueOnce(new Error('source unavailable')),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      {
        enabled: true,
        id: 'calendar-1',
        items: [{ subscriptionId: 'subscription-1' }],
      } as any,
      {
        enabled: true,
        id: 'calendar-2',
        items: [{ subscriptionId: 'subscription-2' }],
      } as any,
    ]);
    calendar.eventsByDateMap$.setValue(
      new Map([
        [
          '2026-07-10',
          [
            {
              ...event,
              externalEventId: 'cached-event',
              id: 'cached-event',
              subscriptionId: 'subscription-2',
              title: 'Cached customer call',
            },
          ],
        ],
      ])
    );

    await expect(
      calendar.revalidateEvents(dayjs('2026-07-10'))
    ).resolves.toMatchObject({
      events: [{ id: 'cached-event' }, { id: 'event-1' }],
      failedSources: 1,
      totalSources: 2,
    });
    expect(calendar.eventsByDateMap$.value.get('2026-07-10')).toMatchObject([
      { id: 'cached-event' },
      { id: 'event-1' },
    ]);
  });

  test('lets a successful cancellation suppress a retained cross-source duplicate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // CalendarIntegration buckets by the user's local calendar day. Derive the
    // UTC payloads from local wall-clock times so this regression stays valid
    // under both Nota's timezone and the full suite's Asia/Singapore setup.
    const localEventIso = (time: string) =>
      dayjs(`2026-07-10T${time}`).toISOString();
    const cachedEvent = {
      __typename: 'CalendarEventObjectType' as const,
      allDay: false,
      description: null,
      endAtUtc: localEventIso('10:00:00'),
      externalEventId: 'shared-event',
      id: 'eventkit:shared-event',
      location: null,
      originalTimezone: 'UTC',
      recurrenceId: null,
      source: 'eventkit' as const,
      startAtUtc: localEventIso('09:00:00'),
      status: 'confirmed',
      subscriptionId: 'eventkit:personal',
      title: 'Customer review',
    };
    const unrelatedCachedEvent = {
      ...cachedEvent,
      endAtUtc: localEventIso('13:00:00'),
      externalEventId: 'lunch',
      id: 'eventkit:lunch',
      startAtUtc: localEventIso('12:00:00'),
      title: 'Lunch',
    };
    const store = {
      fetchEvents: vi
        .fn()
        .mockResolvedValueOnce([
          {
            ...cachedEvent,
            id: 'google:shared-event',
            source: 'google',
            status: 'cancelled',
            subscriptionId: 'google:primary',
          },
        ])
        .mockRejectedValueOnce(new Error('EventKit unavailable')),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      {
        enabled: true,
        id: 'google-workspace-calendar',
        items: [{ subscriptionId: 'google:primary' }],
      } as any,
      {
        enabled: true,
        id: 'eventkit-workspace-calendar',
        items: [{ subscriptionId: 'eventkit:personal' }],
      } as any,
    ]);
    calendar.eventsByDateMap$.setValue(
      new Map([['2026-07-10', [cachedEvent, unrelatedCachedEvent]]])
    );

    await calendar.revalidateEvents(dayjs('2026-07-10'));

    expect(calendar.eventsByDateMap$.value.get('2026-07-10')).toMatchObject([
      { id: 'eventkit:lunch' },
    ]);
  });

  test('drops both canceled spellings and normalizes active event status', async () => {
    const baseEvent = {
      __typename: 'CalendarEventObjectType',
      allDay: false,
      description: null,
      endAtUtc: '2026-07-10T15:00:00.000Z',
      externalEventId: 'event',
      id: 'event',
      location: null,
      originalTimezone: 'UTC',
      recurrenceId: null,
      startAtUtc: '2026-07-10T14:00:00.000Z',
      subscriptionId: 'subscription-1',
      title: 'Project review',
    };
    const store = {
      fetchEvents: vi.fn().mockResolvedValue([
        { ...baseEvent, id: 'uk', status: 'cancelled' },
        { ...baseEvent, id: 'us', status: 'CANCELED' },
        {
          ...baseEvent,
          externalEventId: 'active',
          id: 'active',
          status: ' CONFIRMED ',
        },
      ]),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      { enabled: true, id: 'calendar-1', items: [] } as any,
    ]);

    await calendar.revalidateEvents(dayjs('2026-07-10'));

    expect(calendar.eventsByDateMap$.value.get('2026-07-10')).toMatchObject([
      { id: 'active', status: 'confirmed' },
    ]);
  });

  test('keeps simultaneous cross-source meetings with different join links separate', async () => {
    const baseEvent = {
      __typename: 'CalendarEventObjectType' as const,
      allDay: false,
      description: null,
      endAtUtc: '2026-07-10T15:00:00.000Z',
      location: null,
      originalTimezone: 'UTC',
      recurrenceId: null,
      startAtUtc: '2026-07-10T14:00:00.000Z',
      status: 'confirmed',
      title: 'Project review',
    };
    const store = {
      fetchEvents: vi
        .fn()
        .mockResolvedValueOnce([
          {
            ...baseEvent,
            externalEventId: 'google-event',
            id: 'google-event',
            meetingUrl: 'https://meet.google.com/first-meeting',
            source: 'google',
            subscriptionId: 'google:primary',
          },
        ])
        .mockResolvedValueOnce([
          {
            ...baseEvent,
            externalEventId: 'eventkit-event',
            id: 'eventkit-event',
            meetingUrl: 'https://zoom.us/j/123456789',
            source: 'eventkit',
            subscriptionId: 'eventkit:personal',
          },
        ]),
    };
    const calendar = createCalendarIntegration(store);
    calendar.workspaceCalendars$.setValue([
      { enabled: true, id: 'google-workspace-calendar', items: [] } as any,
      { enabled: true, id: 'eventkit-workspace-calendar', items: [] } as any,
    ]);

    const result = await calendar.revalidateEvents(dayjs('2026-07-10'));

    expect(result.events).toHaveLength(2);
    expect(result.events.map(event => event.id)).toEqual([
      'google-event',
      'eventkit-event',
    ]);
  });
});
