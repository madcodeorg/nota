import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Request) => Promise<Response>>(),
  netFetch: vi.fn(),
  status: {
    available: false,
    error: null as string | null,
    starting: true,
  },
  whenReady: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/nota-user-data') },
  net: { fetch: mocks.netFetch },
  protocol: {
    handle: (
      scheme: string,
      handler: (request: Request) => Promise<Response>
    ) => mocks.handlers.set(scheme, handler),
  },
  session: {
    defaultSession: {
      webRequest: { onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn() },
    },
  },
}));

vi.mock('set-cookie-parser', () => ({ default: { parse: vi.fn(() => []) } }));
vi.mock('../../src/main/config', () => ({ isDev: false }));
vi.mock('../../src/main/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('../../src/shared/utils', () => ({
  isWindows: () => false,
  resourcesPath: '/tmp/nota-resources',
}));
vi.mock('../../src/main/ai-backend', () => ({
  getAiBackendBaseUrl: () => 'http://127.0.0.1:4242',
  getAiBackendStatus: () => mocks.status,
  whenAiBackendReady: mocks.whenReady,
  withAiBackendAuth: (headers?: HeadersInit) => new Headers(headers),
}));

const { registerProtocol } = await import('../../src/main/protocol');

function apiRequest() {
  return new Request('assets://./v1/chat');
}

beforeEach(() => {
  mocks.netFetch.mockReset();
  mocks.whenReady.mockReset();
  registerProtocol();
});

describe('assets protocol before the AI backend is ready', () => {
  it('waits for the backend, then proxies the request', async () => {
    let finishStart!: () => void;
    mocks.whenReady.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishStart = () => {
            mocks.status = { available: true, error: null, starting: false };
            resolve();
          };
        })
    );
    mocks.netFetch.mockResolvedValue(new Response('ok'));

    const response = mocks.handlers.get('assets')!(apiRequest());
    await Promise.resolve();
    expect(mocks.netFetch).not.toHaveBeenCalled();

    finishStart();
    await expect((await response).text()).resolves.toBe('ok');
    expect(mocks.netFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4242/v1/chat',
      expect.anything()
    );
  });

  it('returns a 503 JSON error when the backend failed to start', async () => {
    mocks.status = { available: false, error: 'seed failed', starting: false };
    mocks.whenReady.mockResolvedValue(undefined);

    const response = await mocks.handlers.get('assets')!(apiRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Nota AI is unavailable: seed failed',
    });
    expect(mocks.netFetch).not.toHaveBeenCalled();
  });
});
