/**
 * @vitest-environment happy-dom
 */

import { Framework } from '@nota/infra';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { GoogleSession, type GoogleTokens } from './google-session';

const user = {
  email: 'local@example.com',
  name: 'Local User',
  sub: 'local-user',
};

function expiredBrokerTokens(): GoogleTokens {
  return {
    accessToken: 'expired-access-token',
    authBrokerUrl: 'https://thenota.app',
    expiresAt: Date.now() - 1,
    refreshMode: 'broker',
    refreshToken: 'refresh-token',
  };
}

function createGoogleSession() {
  const framework = new Framework();
  framework.entity(GoogleSession);
  return framework.provider().get(GoogleSession);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('GoogleSession token refresh', () => {
  test('delegates Electron refresh to main and applies a rotated session', async () => {
    const expired = expiredBrokerTokens();
    const persisted = { tokens: expired, userInfo: user };
    const rotated = {
      tokens: {
        ...expired,
        accessToken: 'main-process-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        refreshToken: 'main-process-refresh-token',
      },
      userInfo: user,
    };
    let publishState:
      | ((state: { connected: boolean; mutationId?: string }) => void)
      | undefined;
    const secureApi = {
      clearSession: vi.fn().mockResolvedValue({ connected: false }),
      getSession: vi.fn().mockResolvedValue(persisted),
      refreshSession: vi.fn(async (mutationId?: string) => {
        publishState?.({ connected: true, mutationId });
        return rotated;
      }),
      setSession: vi.fn().mockResolvedValue({ connected: true }),
    };
    const sharedStorage = {
      get: vi.fn(),
      ready: Promise.resolve(),
      watch: vi.fn(
        (
          _key: string,
          callback: (state: { connected: boolean; mutationId?: string }) => void
        ) => {
          publishState = callback;
          return vi.fn();
        }
      ),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('BUILD_CONFIG', {
      ...BUILD_CONFIG,
      isElectron: true,
    });
    vi.stubGlobal('__apis', { googleAuth: secureApi });
    vi.stubGlobal('__sharedStorage', { globalState: sharedStorage });
    vi.stubGlobal('fetch', fetchMock);

    const session = createGoogleSession();
    await vi.waitFor(() => expect(session.status$.value).toBe('connected'));
    await vi.waitFor(() => expect(sharedStorage.watch).toHaveBeenCalledOnce());

    await expect(session.getAccessToken()).resolves.toBe(
      'main-process-access-token'
    );
    expect(secureApi.refreshSession).toHaveBeenCalledOnce();
    expect(secureApi.refreshSession).toHaveBeenCalledWith(expect.any(String));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.getTokensSnapshot()?.refreshToken).toBe(
      'main-process-refresh-token'
    );
  });

  test('uses the refreshed IPC session while another renderer reloads it', async () => {
    const expired = expiredBrokerTokens();
    const persisted = { tokens: expired, userInfo: user };
    const rotated = {
      tokens: {
        ...expired,
        accessToken: 'joined-refresh-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000,
        refreshToken: 'joined-refresh-token',
      },
      userInfo: user,
    };
    let publishState:
      | ((state: { connected: boolean; mutationId?: string }) => void)
      | undefined;
    const neverFinishes = new Promise<unknown>(() => {});
    const secureApi = {
      clearSession: vi.fn().mockResolvedValue({ connected: false }),
      getSession: vi
        .fn()
        .mockResolvedValueOnce(persisted)
        .mockImplementationOnce(() => neverFinishes),
      refreshSession: vi.fn(async () => {
        publishState?.({
          connected: true,
          mutationId: 'another-renderer-refresh',
        });
        return rotated;
      }),
      setSession: vi.fn().mockResolvedValue({ connected: true }),
    };
    const sharedStorage = {
      get: vi.fn(),
      ready: Promise.resolve(),
      watch: vi.fn(
        (
          _key: string,
          callback: (state: { connected: boolean; mutationId?: string }) => void
        ) => {
          publishState = callback;
          return vi.fn();
        }
      ),
    };
    vi.stubGlobal('BUILD_CONFIG', {
      ...BUILD_CONFIG,
      isElectron: true,
    });
    vi.stubGlobal('__apis', { googleAuth: secureApi });
    vi.stubGlobal('__sharedStorage', { globalState: sharedStorage });

    const session = createGoogleSession();
    await vi.waitFor(() => expect(session.status$.value).toBe('connected'));
    await vi.waitFor(() => expect(sharedStorage.watch).toHaveBeenCalledOnce());

    await expect(session.getAccessToken()).resolves.toBe(
      'joined-refresh-access-token'
    );
    expect(session.getTokensSnapshot()?.refreshToken).toBe(
      'joined-refresh-token'
    );
  });

  test('shares one broker refresh across concurrent calendar requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: 'fresh-access-token',
          expiresIn: 3600,
          refreshToken: 'rotated-refresh-token',
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = createGoogleSession();
    await session.setTokens(expiredBrokerTokens(), user);

    const [first, second] = await Promise.all([
      session.getAccessToken(),
      session.getAccessToken(),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(first).toBe('fresh-access-token');
    expect(second).toBe('fresh-access-token');
    expect(session.getTokensSnapshot()?.refreshToken).toBe(
      'rotated-refresh-token'
    );
  });

  test('does not restore a session cleared during an in-flight refresh', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = createGoogleSession();
    await session.setTokens(expiredBrokerTokens(), user);
    const refresh = session.getAccessToken();

    const clear = session.clear();
    resolveFetch(
      new Response(
        JSON.stringify({
          accessToken: 'stale-access-token',
          expiresIn: 3600,
        }),
        { status: 200 }
      )
    );

    await clear;
    await expect(refresh).resolves.toBeNull();
    expect(session.getTokensSnapshot()).toBeNull();
    expect(session.status$.value).toBe('disconnected');
  });

  test.each([
    [400, { error: 'invalid_grant' }],
    [400, { error: 'Invalid broker token' }],
    [401, { error: 'Unauthorized' }],
  ])('clears a broker session rejected with HTTP %s', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
          status,
        })
      )
    );

    const session = createGoogleSession();
    await session.setTokens(expiredBrokerTokens(), user);

    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(session.getTokensSnapshot()).toBeNull();
    expect(session.status$.value).toBe('disconnected');
  });

  test('keeps a session retryable after a transient refresh failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503,
        })
      )
    );

    const session = createGoogleSession();
    await session.setTokens(expiredBrokerTokens(), user);

    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(session.getTokensSnapshot()?.refreshToken).toBe('refresh-token');
    expect(session.status$.value).toBe('error');
  });
});

describe('GoogleSession secure persistence', () => {
  test('does not invalidate its own secure-write acknowledgement broadcast', async () => {
    let publishState:
      | ((state: { connected: boolean; mutationId?: string }) => void)
      | undefined;
    let persistedMutationId: string | undefined;
    const secureApi = {
      clearSession: vi.fn().mockResolvedValue({ connected: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn(async (_session: unknown, mutationId?: string) => {
        persistedMutationId = mutationId;
        return { connected: true, mutationId };
      }),
    };
    const sharedStorage = {
      get: vi.fn(),
      ready: Promise.resolve(),
      watch: vi.fn(
        (
          _key: string,
          callback: (state: { connected: boolean; mutationId?: string }) => void
        ) => {
          publishState = callback;
          return vi.fn();
        }
      ),
    };
    vi.stubGlobal('BUILD_CONFIG', {
      ...BUILD_CONFIG,
      isElectron: true,
    });
    vi.stubGlobal('__apis', { googleAuth: secureApi });
    vi.stubGlobal('__sharedStorage', { globalState: sharedStorage });

    const session = createGoogleSession();
    await vi.waitFor(() => expect(sharedStorage.watch).toHaveBeenCalledOnce());
    const tokens = {
      ...expiredBrokerTokens(),
      accessToken: 'secure-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
    };

    await expect(session.setTokens(tokens, user)).resolves.toBeUndefined();
    publishState?.({
      connected: true,
      mutationId: persistedMutationId,
    });
    await Promise.resolve();
    expect(session.getTokensSnapshot()).toEqual(tokens);
    expect(session.status$.value).toBe('connected');
  });

  test('restores a securely persisted session after reload', async () => {
    let persisted: unknown = null;
    const secureApi = {
      clearSession: vi.fn().mockResolvedValue({ connected: false }),
      getSession: vi.fn(async () => persisted),
      setSession: vi.fn(async (session: unknown) => {
        persisted = session;
        return { connected: true };
      }),
    };
    vi.stubGlobal('BUILD_CONFIG', {
      ...BUILD_CONFIG,
      isElectron: true,
    });
    vi.stubGlobal('__apis', { googleAuth: secureApi });

    const tokens = {
      ...expiredBrokerTokens(),
      accessToken: 'persisted-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const session = createGoogleSession();
    await session.setTokens(tokens, user);

    expect(secureApi.setSession).toHaveBeenCalledOnce();
    expect(session.status$.value).toBe('connected');

    const restored = createGoogleSession();
    await vi.waitFor(() => expect(restored.status$.value).toBe('connected'));
    expect(restored.getTokensSnapshot()).toEqual(tokens);
    expect(restored.userInfo$.value).toEqual(user);
  });

  test('keeps the prior valid session when replacement persistence fails', async () => {
    const previousTokens = {
      ...expiredBrokerTokens(),
      accessToken: 'previous-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const persisted = { tokens: previousTokens, userInfo: user };
    const secureApi = {
      clearSession: vi.fn().mockResolvedValue({ connected: false }),
      getSession: vi.fn().mockResolvedValue(persisted),
      setSession: vi
        .fn()
        .mockRejectedValue(new Error('Secure storage write failed')),
    };
    vi.stubGlobal('BUILD_CONFIG', {
      ...BUILD_CONFIG,
      isElectron: true,
    });
    vi.stubGlobal('__apis', { googleAuth: secureApi });

    const session = createGoogleSession();
    await vi.waitFor(() => expect(session.status$.value).toBe('connected'));

    await expect(
      session.setTokens(
        {
          ...previousTokens,
          accessToken: 'replacement-access-token',
          refreshToken: 'replacement-refresh-token',
        },
        user
      )
    ).rejects.toThrow('Secure storage write failed');

    expect(session.status$.value).toBe('connected');
    expect(session.getTokensSnapshot()).toEqual(previousTokens);

    const restored = createGoogleSession();
    await vi.waitFor(() => expect(restored.status$.value).toBe('connected'));
    expect(restored.getTokensSnapshot()).toEqual(previousTokens);
  });

  test('keeps the prior session connected when secure logout deletion fails', async () => {
    const previousTokens = {
      ...expiredBrokerTokens(),
      accessToken: 'previous-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const persisted = { tokens: previousTokens, userInfo: user };
    const secureApi = {
      clearSession: vi
        .fn()
        .mockRejectedValue(new Error('Secure session deletion failed')),
      getSession: vi.fn().mockResolvedValue(persisted),
      setSession: vi.fn().mockResolvedValue({ connected: true }),
    };
    vi.stubGlobal('BUILD_CONFIG', {
      ...BUILD_CONFIG,
      isElectron: true,
    });
    vi.stubGlobal('__apis', { googleAuth: secureApi });

    const session = createGoogleSession();
    await vi.waitFor(() => expect(session.status$.value).toBe('connected'));

    await expect(session.clear()).rejects.toThrow(
      'Secure session deletion failed'
    );
    expect(session.getTokensSnapshot()).toEqual(previousTokens);
    expect(session.userInfo$.value).toEqual(user);
    expect(session.status$.value).toBe('connected');
  });
});
