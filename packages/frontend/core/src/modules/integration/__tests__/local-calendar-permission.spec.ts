import { describe, expect, test } from 'vitest';

import { presentLocalCalendarPermission } from '../local-calendar-permission';
import type {
  LocalCalendarAuthorizationStatus,
  LocalCalendarStatus,
} from '../type';

function calendarStatus(
  status: LocalCalendarAuthorizationStatus,
  overrides: Partial<LocalCalendarStatus> = {}
): LocalCalendarStatus {
  return {
    available: true,
    authorized: status === 'authorized',
    status,
    supported: status !== 'unsupported',
    ...overrides,
  };
}

describe('presentLocalCalendarPermission', () => {
  test.each([
    {
      action: null,
      actionLabel: null,
      connected: true,
      description: 'Full Access',
      status: 'authorized',
      title: 'Apple Calendar connected',
    },
    {
      action: 'connect',
      actionLabel: 'Connect',
      connected: false,
      description: 'has not requested Apple Calendar access',
      status: 'not-determined',
      title: 'Connect Apple Calendar',
    },
    {
      action: 'request-full-access',
      actionLabel: 'Request Full Access',
      connected: false,
      description: 'Add Only access',
      status: 'write-only',
      title: 'Apple Calendar needs Full Access',
    },
    {
      action: 'open-settings',
      actionLabel: 'Open Settings',
      connected: false,
      description: 'access is off',
      status: 'denied',
      title: 'Apple Calendar access is off',
    },
    {
      action: 'open-settings',
      actionLabel: 'Open Settings',
      connected: false,
      description: 'policy is restricting',
      status: 'restricted',
      title: 'Apple Calendar access is restricted',
    },
    {
      action: 'retry',
      actionLabel: 'Retry',
      connected: false,
      description: 'Could not verify',
      status: 'unknown',
      title: 'Could not verify Apple Calendar',
    },
    {
      action: null,
      actionLabel: null,
      connected: false,
      description: 'unavailable',
      status: 'unsupported',
      title: 'Apple Calendar unavailable',
    },
  ] satisfies Array<{
    action:
      | 'connect'
      | 'open-settings'
      | 'request-full-access'
      | 'retry'
      | null;
    actionLabel: string | null;
    connected: boolean;
    description: string;
    status: LocalCalendarAuthorizationStatus;
    title: string;
  }>)('$status', expected => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus(expected.status)
    );

    expect(presentation).toMatchObject({
      action: expected.action,
      actionLabel: expected.actionLabel,
      connected: expected.connected,
      title: expected.title,
    });
    expect(presentation.description).toContain(expected.description);
  });

  test('treats an unavailable checker as unverifiable, not as missing access', () => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus('denied', {
        available: false,
        reason: 'Calendar permission was not granted.',
      })
    );

    expect(presentation).toMatchObject({
      action: 'retry',
      actionLabel: 'Retry',
      connected: false,
      title: 'Could not verify Apple Calendar',
    });
    expect(presentation.description).toContain('Could not verify');
    expect(presentation.description).not.toContain('not granted');
  });

  test.each(['not-determined', 'write-only', 'unknown'] as const)(
    'offers only a passive status check while a %s request is pending',
    status => {
      expect(
        presentLocalCalendarPermission(
          calendarStatus(status, { requestPending: true })
        )
      ).toMatchObject({
        action: 'retry',
        actionLabel: 'Check status',
        connected: false,
        title: 'Waiting for Apple Calendar',
      });
    }
  );

  test('preserves pending consent when the status checker is unavailable', () => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus('unknown', {
        available: false,
        requestPending: true,
        permissionClient: {
          bundleIdentifier: 'pro.nota.app.dev',
          displayName: 'Nota Dev',
          kind: 'development-host',
        },
      })
    );

    expect(presentation.actionLabel).toBe('Check status');
    expect(presentation.description).toContain(
      'Nota Dev (local development) is still waiting for macOS'
    );
    expect(presentation.description).toContain('separate macOS permission');
  });

  test('shows confirmed authorization even before the pending callback finishes', () => {
    expect(
      presentLocalCalendarPermission(
        calendarStatus('authorized', { requestPending: true })
      )
    ).toMatchObject({
      action: null,
      connected: true,
      title: 'Apple Calendar connected',
    });
  });

  test('exposes a native compatibility failure instead of only suggesting retry', () => {
    const reason =
      'Apple Calendar native binding is outdated or incompatible. Rebuild the calendar native binding and restart Nota.';
    const presentation = presentLocalCalendarPermission(
      calendarStatus('unknown', { available: false, reason })
    );

    expect(presentation.connected).toBe(false);
    expect(presentation.description).toContain(reason);
  });

  test.each([
    'authorized',
    'not-determined',
    'write-only',
    'denied',
    'restricted',
    'unknown',
  ] satisfies LocalCalendarAuthorizationStatus[])(
    'explains the separate installed permission for a local %s result',
    status => {
      const presentation = presentLocalCalendarPermission(
        calendarStatus(status, {
          permissionClient: {
            bundleIdentifier: 'com.github.Electron',
            displayName: 'Electron',
            kind: 'development-host',
          },
        })
      );

      expect(presentation.description).toContain(
        'Electron (local development)'
      );
      expect(presentation.description).toContain(
        'Installed Nota has a separate macOS permission and was not checked.'
      );
    }
  );

  test('names Add Only access for the actual local permission client', () => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus('write-only', {
        permissionClient: {
          bundleIdentifier: 'com.github.Electron',
          displayName: 'Electron',
          kind: 'development-host',
        },
      })
    );

    expect(presentation.description).toContain(
      'macOS gives Electron (local development) Add Only access'
    );
    expect(presentation.description).toContain(
      'Choose Full Access for Electron'
    );
    expect(presentation.description).not.toContain('Nota needs Full Access');
  });

  test('does not attribute an unavailable local checker to installed Nota', () => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus('unknown', {
        available: false,
        permissionClient: {
          bundleIdentifier: 'com.github.Electron',
          displayName: 'Electron',
          kind: 'development-host',
        },
      })
    );

    expect(presentation.description).toContain(
      'Could not verify Apple Calendar access for Electron (local development)'
    );
    expect(presentation.description).toContain(
      'Installed Nota has a separate macOS permission and was not checked.'
    );
  });

  test('uses the packaged app name without implying a separate installed app', () => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus('denied', {
        permissionClient: {
          bundleIdentifier: 'pro.nota.app',
          displayName: 'Nota',
          kind: 'packaged-build',
        },
      })
    );

    expect(presentation.description).toContain(
      'access is off for Nota (this running build)'
    );
    expect(presentation.description).not.toContain('separate macOS permission');
  });

  test('uses neutral copy when older clients omit identity metadata', () => {
    const presentation = presentLocalCalendarPermission(
      calendarStatus('denied')
    );

    expect(presentation.description).toContain('access is off for this app');
    expect(presentation.description).not.toContain('access is off for Nota');
  });

  test('shows a neutral checking state before the first result', () => {
    expect(presentLocalCalendarPermission(null)).toEqual({
      action: null,
      actionLabel: null,
      connected: false,
      description: 'Checking Apple Calendar access…',
      title: 'Checking Apple Calendar access',
    });
  });
});
