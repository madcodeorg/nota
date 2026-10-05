import { afterEach, describe, expect, test, vi } from 'vitest';

import type { StoredGoogleSession } from '../../src/main/windows-manager/google-calendar-scheduler';

const secureStore = vi.hoisted(() => ({
  clear: vi.fn(),
  current: null as unknown,
  read: vi.fn(),
  save: vi.fn(),
}));
const resolveRefresh = vi.hoisted(() => vi.fn());

vi.mock('../../src/main/google-auth/secure-session', () => ({
  clearSecureGoogleSession: secureStore.clear,
  readSecureGoogleSession: secureStore.read,
  saveSecureGoogleSession: secureStore.save,
}));

vi.mock('../../src/main/windows-manager/google-calendar-scheduler', () => ({
  isGoogleSessionRevokedError: (error: unknown) =>
    error instanceof Error && error.name === 'GoogleSessionRevokedError',
  resolveGoogleCalendarSession: resolveRefresh,
}));

import {
  resetGoogleSessionRefreshForTest,
  resolveSecureGoogleSession,
} from '../../src/main/google-auth/session-refresh';

function session(
  accessToken: string,
  refreshToken: string
): StoredGoogleSession {
  return {
    tokens: {
      accessToken,
      expiresAt: Date.now() - 1,
      refreshMode: 'broker',
      refreshToken,
    },
    userInfo: { sub: 'user-1' },
  };
}

afterEach(() => {
  vi.useRealTimers();
  resetGoogleSessionRefreshForTest();
  secureStore.current = null;
  secureStore.clear.mockReset();
  secureStore.read.mockReset();
  secureStore.save.mockReset();
  resolveRefresh.mockReset();
});

describe('main-process Google session refresh', () => {
  test('shares and persists one rotating refresh across concurrent callers', async () => {
    const source = session('expired-access', 'refresh-1');
    const refreshed = session('fresh-access', 'refresh-2');
    secureStore.current = source;
    secureStore.read.mockImplementation(() => secureStore.current);
    secureStore.save.mockImplementation(value => {
      secureStore.current = value;
    });
    let finishRefresh!: (value: StoredGoogleSession) => void;
    resolveRefresh.mockImplementation(
      () =>
        new Promise<StoredGoogleSession>(resolve => {
          finishRefresh = resolve;
        })
    );

    const meetingScheduler = resolveSecureGoogleSession();
    const renderer = resolveSecureGoogleSession('renderer-refresh-1');
    expect(resolveRefresh).toHaveBeenCalledOnce();

    finishRefresh(refreshed);

    await expect(renderer).resolves.toBe(refreshed);
    await expect(meetingScheduler).resolves.toBe(refreshed);
    expect(secureStore.save).toHaveBeenCalledOnce();
    expect(secureStore.save).toHaveBeenCalledWith(
      refreshed,
      'renderer-refresh-1'
    );
    expect(secureStore.current).toBe(refreshed);
  });

  test('does not overwrite a replacement session after an in-flight refresh', async () => {
    const source = session('expired-access', 'refresh-1');
    const replacement = session('replacement-access', 'replacement-refresh');
    const staleRefresh = session('stale-access', 'refresh-2');
    secureStore.current = source;
    secureStore.read.mockImplementation(() => secureStore.current);
    let finishRefresh!: (value: StoredGoogleSession) => void;
    resolveRefresh.mockImplementation(
      () =>
        new Promise<StoredGoogleSession>(resolve => {
          finishRefresh = resolve;
        })
    );

    const refresh = resolveSecureGoogleSession();
    secureStore.current = replacement;
    finishRefresh(staleRefresh);

    await expect(refresh).resolves.toBe(replacement);
    expect(secureStore.save).not.toHaveBeenCalled();
  });

  test('bounds a stalled shared refresh and allows the next attempt', async () => {
    vi.useFakeTimers();
    secureStore.current = session('expired-access', 'refresh-1');
    secureStore.read.mockImplementation(() => secureStore.current);
    resolveRefresh.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );

    const stalled = resolveSecureGoogleSession();
    const rejection = expect(stalled).rejects.toSatisfy(
      error => error instanceof DOMException && error.name === 'AbortError'
    );
    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;

    resolveRefresh.mockResolvedValue(secureStore.current);
    await resolveSecureGoogleSession();
    expect(resolveRefresh).toHaveBeenCalledTimes(2);
  });
});
