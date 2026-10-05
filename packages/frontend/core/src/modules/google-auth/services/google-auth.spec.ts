/**
 * @vitest-environment happy-dom
 */

import { Framework } from '@nota/infra';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { GoogleSession } from '../entities/google-session';
import { GoogleAuthService } from './google-auth';

const FLOW_A = 'a'.repeat(43);
const FLOW_B = 'b'.repeat(43);

type GoogleAuthApiMock = {
  beginLoopbackFlow: ReturnType<typeof vi.fn>;
  cancelLoopbackFlow: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  pollLoopbackFlow: ReturnType<typeof vi.fn>;
  setSession: ReturnType<typeof vi.fn>;
};

function createApi(): GoogleAuthApiMock {
  return {
    beginLoopbackFlow: vi.fn(),
    cancelLoopbackFlow: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue({ connected: false }),
    getSession: vi.fn().mockResolvedValue(null),
    pollLoopbackFlow: vi.fn().mockResolvedValue(null),
    setSession: vi.fn().mockResolvedValue({ connected: true }),
  };
}

function createService(api: GoogleAuthApiMock) {
  const openExternal = vi.fn();
  vi.stubGlobal('BUILD_CONFIG', {
    ...BUILD_CONFIG,
    googleAuthBrokerUrl: 'https://broker.example',
    isElectron: true,
    isNative: false,
    isWeb: false,
  });
  vi.stubGlobal('__apis', { googleAuth: api });

  const framework = new Framework();
  framework.entity(GoogleSession);
  framework.service(
    GoogleAuthService,
    () => new GoogleAuthService({ openExternal } as never)
  );
  const service = framework.provider().get(GoogleAuthService);
  return { openExternal, service };
}

function brokerTokenResponse(accessToken: string) {
  return new Response(
    JSON.stringify({
      accessToken,
      expiresIn: 3600,
      refreshToken: `${accessToken}-refresh`,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      userInfo: {
        email: 'local@example.com',
        name: 'Local User',
        sub: 'local-user',
      },
    }),
    { status: 200 }
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('GoogleAuthService loopback flow ownership', () => {
  test('completes the intended broker flow through restricted IPC', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.beginLoopbackFlow.mockResolvedValue({
      flowId: FLOW_A,
      redirectUri: 'http://127.0.0.1:41013/auth/callback',
    });
    api.pollLoopbackFlow.mockResolvedValue({ brokerCode: 'broker-code' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(brokerTokenResponse('flow-a-access'));
    vi.stubGlobal('fetch', fetchMock);
    const { openExternal, service } = createService(api);

    const connection = service.connect();
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());
    const authUrl = new URL(openExternal.mock.calls[0][0] as string);
    const redirectUri = new URL(authUrl.searchParams.get('redirect_uri') ?? '');
    expect(redirectUri.searchParams.get('nota_flow')).toBe(FLOW_A);

    await vi.advanceTimersByTimeAsync(500);
    await expect(connection).resolves.toBeUndefined();
    expect(api.pollLoopbackFlow).toHaveBeenCalledWith(FLOW_A);
    expect(api.cancelLoopbackFlow).toHaveBeenCalledWith(FLOW_A);
    expect(service.session.getTokensSnapshot()?.accessToken).toBe(
      'flow-a-access'
    );
  });

  test('cancels an older connect before a replacement can persist tokens', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.beginLoopbackFlow
      .mockResolvedValueOnce({
        flowId: FLOW_A,
        redirectUri: 'http://127.0.0.1:41013/auth/callback',
      })
      .mockResolvedValueOnce({
        flowId: FLOW_B,
        redirectUri: 'http://127.0.0.1:41013/auth/callback',
      });
    api.pollLoopbackFlow.mockImplementation(async (flowId: string) =>
      flowId === FLOW_B ? { brokerCode: 'flow-b-code' } : null
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(brokerTokenResponse('flow-b-access'))
    );
    const { openExternal, service } = createService(api);

    const firstConnection = service.connect();
    const firstOutcome = firstConnection.catch(error => error as Error);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));

    const secondConnection = service.connect();
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(500);

    await expect(secondConnection).resolves.toBeUndefined();
    await expect(firstOutcome).resolves.toMatchObject({ name: 'AbortError' });
    expect(api.cancelLoopbackFlow).toHaveBeenCalledWith(FLOW_A);
    expect(api.cancelLoopbackFlow).toHaveBeenCalledWith(FLOW_B);
    expect(service.session.getTokensSnapshot()?.accessToken).toBe(
      'flow-b-access'
    );
  });

  test('clears the registered flow when authorization times out', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.beginLoopbackFlow.mockResolvedValue({
      flowId: FLOW_A,
      redirectUri: 'http://127.0.0.1:41013/auth/callback',
    });
    const { openExternal, service } = createService(api);

    const connection = service.connect();
    const outcome = connection.catch(error => error as Error);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await expect(outcome).resolves.toMatchObject({ message: 'OAuth timeout' });
    expect(api.cancelLoopbackFlow).toHaveBeenCalledWith(FLOW_A);
  });

  test('waits for secure persistence before reporting connected', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.getSession.mockReturnValue(new Promise(() => {}));
    api.beginLoopbackFlow.mockResolvedValue({
      flowId: FLOW_A,
      redirectUri: 'http://127.0.0.1:41013/auth/callback',
    });
    api.pollLoopbackFlow.mockResolvedValue({ brokerCode: 'broker-code' });
    let resolvePersistence!: (value: { connected: boolean }) => void;
    api.setSession.mockReturnValue(
      new Promise(resolve => {
        resolvePersistence = resolve;
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(brokerTokenResponse('durable-access'))
    );
    const { service } = createService(api);

    const connection = service.connect();
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(api.setSession).toHaveBeenCalledOnce());

    expect(service.session.status$.value).toBe('connecting');
    expect(service.session.getTokensSnapshot()).toBeNull();

    resolvePersistence({ connected: true });
    await expect(connection).resolves.toBeUndefined();
    expect(service.session.status$.value).toBe('connected');
    expect(service.session.getTokensSnapshot()?.accessToken).toBe(
      'durable-access'
    );
  });

  test('surfaces secure persistence failure without claiming connected', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.getSession.mockReturnValue(new Promise(() => {}));
    api.beginLoopbackFlow.mockResolvedValue({
      flowId: FLOW_A,
      redirectUri: 'http://127.0.0.1:41013/auth/callback',
    });
    api.pollLoopbackFlow.mockResolvedValue({ brokerCode: 'broker-code' });
    api.setSession.mockRejectedValue(new Error('Secure storage write failed'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(brokerTokenResponse('unpersisted-access'))
    );
    const { service } = createService(api);

    const connection = service.connect();
    const outcome = connection.catch(error => error as Error);
    await vi.advanceTimersByTimeAsync(500);

    await expect(outcome).resolves.toMatchObject({
      message: 'Secure storage write failed',
    });
    expect(service.session.status$.value).toBe('error');
    expect(service.session.getTokensSnapshot()).toBeNull();
  });
});
