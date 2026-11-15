import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resources = mkdtempSync(path.join(tmpdir(), 'nota-dev-fonts-'));
mkdirSync(path.join(resources, 'web-static', 'fonts'), { recursive: true });
writeFileSync(path.join(resources, 'web-static', 'fonts', 'Local.woff2'), '');

const mocks = vi.hoisted(() => {
  process.env.DEV_SERVER_URL = 'http://localhost:8080';
  return {
    handlers: new Map<string, (request: Request) => Promise<Response>>(),
    netFetch: vi.fn(),
  };
});

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
vi.mock('../../src/main/config', () => ({ isDev: true }));
vi.mock('../../src/main/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('../../src/shared/utils', () => ({
  isWindows: () => false,
  resourcesPath: resources,
}));
vi.mock('../../src/main/ai-backend', () => ({
  getAiBackendBaseUrl: () => 'http://127.0.0.1:4242',
  getAiBackendStatus: () => ({ available: true, error: null, starting: false }),
  whenAiBackendReady: vi.fn(),
  withAiBackendAuth: (headers?: HeadersInit) => new Headers(headers),
}));

const { registerProtocol } = await import('../../src/main/protocol');

function fontRequest(pathname: string) {
  return new Request(`assets://.${pathname}`, {
    headers: { Origin: 'assets://.' },
  });
}

beforeEach(() => {
  mocks.netFetch.mockReset();
  mocks.netFetch.mockResolvedValue(new Response('font'));
  registerProtocol();
});

describe('dev font loading', () => {
  it('fetches a font missing from web-static from the dev server without the renderer Origin', async () => {
    const response = await mocks.handlers.get('assets')!(
      fontRequest('/Inter-VariableFont_slnt,wght.1cccc37b.ttf')
    );

    await expect(response.text()).resolves.toBe('font');
    // net.fetch rejects an `assets://` Origin for http targets, so the font
    // must be requested by URL alone.
    expect(mocks.netFetch).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:8080/Inter-VariableFont_slnt,wght.1cccc37b.ttf'
    );
  });

  it('serves a font that exists in web-static from disk', async () => {
    await mocks.handlers.get('assets')!(fontRequest('/fonts/Local.woff2'));

    expect(mocks.netFetch).toHaveBeenCalledOnce();
    expect(mocks.netFetch.mock.calls[0][0]).toBe(
      `file://${path.join(resources, 'web-static', 'fonts', 'Local.woff2')}`
    );
  });
});
