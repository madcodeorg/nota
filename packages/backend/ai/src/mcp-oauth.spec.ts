import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelMcpOAuthSignIn,
  clearMcpOAuthTokens,
  createMcpOAuthProvider,
  mcpAuthFilePath,
  readMcpAuth,
  startMcpOAuthSignIn,
  writeMcpAuth,
} from './mcp-oauth';

const SERVER_URL = 'https://mcp.example.com/mcp';

let root = '';
let settingsPath = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-mcp-oauth-'));
  settingsPath = path.join(root, 'ai-settings.json');
});

afterEach(async () => {
  cancelMcpOAuthSignIn(settingsPath, 'Remote');
  await rm(root, { force: true, recursive: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function mockAuthorizationServer() {
  const requests: Array<{ body?: string; url: string }> = [];
  const fetchFn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({
        body: init?.body ? String(init.body) : undefined,
        url: url.href,
      });
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return json({
          authorization_servers: ['https://mcp.example.com'],
          resource: SERVER_URL,
        });
      }
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
        return json({
          authorization_endpoint: 'https://mcp.example.com/authorize',
          code_challenge_methods_supported: ['S256'],
          issuer: 'https://mcp.example.com',
          registration_endpoint: 'https://mcp.example.com/register',
          response_types_supported: ['code'],
          token_endpoint: 'https://mcp.example.com/token',
        });
      }
      if (url.pathname === '/register') {
        const metadata = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return json(
          { ...metadata, client_id: `dynamic-${requests.length}` },
          201
        );
      }
      if (url.pathname === '/token') {
        return json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
        });
      }
      return new Response('not found', { status: 404 });
    }
  );
  return { fetchFn: fetchFn as unknown as typeof fetch, requests };
}

describe('MCP OAuth credential storage', () => {
  it('writes private credential files and round-trips tokens', async () => {
    const provider = createMcpOAuthProvider({
      auth: {},
      name: 'Remote',
      settingsPath,
    });
    expect(await provider.tokens()).toBeUndefined();
    await provider.saveTokens({ access_token: 'a', token_type: 'Bearer' });
    expect(await provider.tokens()).toEqual({
      access_token: 'a',
      token_type: 'Bearer',
    });

    const file = mcpAuthFilePath(settingsPath, 'Remote');
    expect(path.basename(path.dirname(file))).toBe('mcp-auth');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);

    await provider.invalidateCredentials?.('tokens');
    expect(await provider.tokens()).toBeUndefined();
  });

  it('re-registers dynamic clients when the redirect changes and uses configured clients as-is', async () => {
    writeMcpAuth(settingsPath, 'Remote', {
      clientInformation: { client_id: 'old-client' },
      redirectUrl: 'http://127.0.0.1:1111/callback',
    });
    const signIn = (redirectUrl: string) =>
      createMcpOAuthProvider({
        auth: {},
        name: 'Remote',
        settingsPath,
        signIn: { onRedirect() {}, redirectUrl, state: 's' },
      });
    expect(
      await signIn('http://127.0.0.1:1111/callback').clientInformation()
    ).toEqual({
      client_id: 'old-client',
    });
    expect(
      await signIn('http://127.0.0.1:2222/callback').clientInformation()
    ).toBeUndefined();
    expect(
      await createMcpOAuthProvider({
        auth: {},
        name: 'Remote',
        settingsPath,
      }).clientInformation()
    ).toEqual({ client_id: 'old-client' });

    const configured = createMcpOAuthProvider({
      auth: { clientId: 'nota', clientSecret: 'shh', scopes: 'read' },
      name: 'Remote',
      settingsPath,
      signIn: {
        onRedirect() {},
        redirectUrl: 'http://127.0.0.1:2222/callback',
        state: 's',
      },
    });
    expect(await configured.clientInformation()).toEqual({
      client_id: 'nota',
      client_secret: 'shh',
    });
    expect(await configured.isClientInformationDynamicallyRegistered?.()).toBe(
      false
    );
    expect(configured.clientMetadata).toMatchObject({
      client_name: 'Nota',
      redirect_uris: ['http://127.0.0.1:2222/callback'],
      scope: 'read',
      token_endpoint_auth_method: 'client_secret_post',
    });
  });
});

describe('MCP OAuth sign-in', () => {
  it('registers a client, completes the loopback callback, and stores tokens', async () => {
    const { fetchFn, requests } = mockAuthorizationServer();
    const onComplete = vi.fn();
    const { url } = await startMcpOAuthSignIn({
      auth: {},
      fetchFn,
      name: 'Remote',
      onComplete,
      serverUrl: SERVER_URL,
      settingsPath,
    });
    const authorizeUrl = new URL(url);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      'https://mcp.example.com/authorize'
    );
    const redirect = authorizeUrl.searchParams.get('redirect_uri')!;
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const state = authorizeUrl.searchParams.get('state')!;
    expect(authorizeUrl.searchParams.get('client_id')).toMatch(/^dynamic-/);
    expect(readMcpAuth(settingsPath, 'Remote')).toEqual({});

    const wrongState = await fetch(`${redirect}?code=c&state=wrong`);
    expect(wrongState.status).toBe(400);

    const callback = await fetch(
      `${redirect}?code=c&state=${encodeURIComponent(state)}`
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).toBe('Sign-in complete. Return to Nota.');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(readMcpAuth(settingsPath, 'Remote')).toMatchObject({
      clientInformation: {
        client_id: authorizeUrl.searchParams.get('client_id'),
      },
      redirectUrl: redirect,
      tokens: { access_token: 'access-token', refresh_token: 'refresh-token' },
    });
    expect(
      requests.some(request => request.url === 'https://mcp.example.com/token')
    ).toBe(true);
    await expect(
      fetch(`${redirect}?code=c&state=${encodeURIComponent(state)}`)
    ).rejects.toThrow();
  });

  it('reuses the callback port and client registration after signing out', async () => {
    const { fetchFn, requests } = mockAuthorizationServer();
    const start = () =>
      startMcpOAuthSignIn({
        auth: {},
        fetchFn,
        name: 'Remote',
        serverUrl: SERVER_URL,
        settingsPath,
      });
    const first = new URL((await start()).url);
    const redirect = first.searchParams.get('redirect_uri')!;
    const callback = await fetch(
      `${redirect}?code=c&state=${encodeURIComponent(first.searchParams.get('state')!)}`
    );
    expect(callback.status).toBe(200);

    clearMcpOAuthTokens(settingsPath, 'Remote');
    expect(readMcpAuth(settingsPath, 'Remote').tokens).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 50));

    const second = new URL((await start()).url);
    expect(second.searchParams.get('redirect_uri')).toBe(redirect);
    expect(second.searchParams.get('client_id')).toBe(
      first.searchParams.get('client_id')
    );
    expect(
      requests.filter(request => request.url.endsWith('/register'))
    ).toHaveLength(1);
  });

  it('cancels the previous pending sign-in when a new one starts', async () => {
    const { fetchFn } = mockAuthorizationServer();
    const first = await startMcpOAuthSignIn({
      auth: {},
      fetchFn,
      name: 'Remote',
      serverUrl: SERVER_URL,
      settingsPath,
    });
    await startMcpOAuthSignIn({
      auth: {},
      fetchFn,
      name: 'Remote',
      serverUrl: SERVER_URL,
      settingsPath,
    });
    const redirect = new URL(first.url).searchParams.get('redirect_uri')!;
    await expect(fetch(`${redirect}?code=c&state=x`)).rejects.toThrow();
  });
});
