import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { ChatGPTAuth } from './chatgpt-auth';

const keyFixture = vi.hoisted(() => ({ publicKey: undefined as unknown }));
vi.mock('jose', async importOriginal => ({
  ...(await importOriginal<typeof import('jose')>()),
  createRemoteJWKSet: () => async () => keyFixture.publicKey,
}));

const directories: string[] = [];
const services: ChatGPTAuth[] = [];
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  keyFixture.publicKey = keys.publicKey;
});
afterEach(() => {
  services.forEach(service => service.cancelSignIn());
  services.length = 0;
  directories.forEach(directory =>
    rmSync(directory, { recursive: true, force: true })
  );
  directories.length = 0;
});

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nota-oauth-test-'));
  directories.push(directory);
  const settingsPath = path.join(directory, 'settings.json');
  let authorization: URL;
  let subject = 'fixture-user';
  let scope: string | undefined =
    'openid email offline_access resource.invoke chatgpt.tokens.use.direct';
  let exchangeFailure = false;
  let invalidGrant = false;
  let invalidNonce = false;
  let invalidSignature = false;
  let invalidIdentity: 'issuer' | 'audience' | 'expiry' | undefined;
  let refreshCount = 0;
  const requests: {
    url: string;
    init?: RequestInit;
    form?: URLSearchParams;
  }[] = [];
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const form =
        init?.body instanceof URLSearchParams ? init.body : undefined;
      requests.push({ url, init, form });
      if (url.endsWith('/oauth/token')) {
        if (form?.get('grant_type') === 'refresh_token') {
          refreshCount++;
          await new Promise(resolve => setTimeout(resolve, 5));
          return Response.json(
            invalidGrant
              ? { error: 'invalid_grant' }
              : {
                  access_token: 'fixture-renewed-access',
                  refresh_token: 'fixture-rotated-refresh',
                  token_type: 'Bearer',
                  expires_in: 3600,
                  ...(scope === undefined ? {} : { scope }),
                },
            { status: invalidGrant ? 400 : 200 }
          );
        }
        if (exchangeFailure)
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const claims = {
          nonce: invalidNonce
            ? 'wrong-nonce'
            : authorization.searchParams.get('nonce'),
          email: 'fixture@example.test',
        };
        let idToken = await new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256' })
          .setIssuer(
            invalidIdentity === 'issuer'
              ? 'https://unexpected.example.test'
              : 'https://auth.openai.com'
          )
          .setAudience(
            invalidIdentity === 'audience'
              ? 'unexpected-client'
              : form!.get('client_id')!
          )
          .setSubject(subject)
          .setExpirationTime(
            invalidIdentity === 'expiry'
              ? Math.floor(Date.now() / 1000) - 30
              : '1h'
          )
          .sign(keys.privateKey);
        if (invalidSignature) {
          const parts = idToken.split('.');
          const signature = Buffer.from(parts[2], 'base64url');
          signature[0] ^= 1;
          parts[2] = signature.toString('base64url');
          idToken = parts.join('.');
        }
        return Response.json({
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 3600,
          ...(scope === undefined ? {} : { scope }),
        });
      }
      if (url.endsWith('/models'))
        return Response.json({
          models: [
            {
              slug: 'fixture-chat',
              display_name: 'Fixture chat',
              visibility: 'list',
            },
            { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
          ],
        });
      if (url.endsWith('/openid-configuration'))
        return Response.json({
          revocation_endpoint:
            'https://auth.openai.com/api/accounts/oauth/revoke',
        });
      if (url.endsWith('/oauth/revoke'))
        return new Response(null, { status: 200 });
      throw new Error('Unexpected fixture network request.');
    }
  ) as unknown as typeof fetch;
  const auth = new ChatGPTAuth(
    { settingsPath },
    { fetch: fetcher, signInTimeoutMs: 10_000 }
  );
  services.push(auth);
  async function start(options?: Parameters<ChatGPTAuth['startSignIn']>[0]) {
    const result = await auth.startSignIn(options);
    authorization = new URL(result.url);
    return authorization;
  }
  async function callback(
    options: { state?: string; error?: string; issuedId?: string } = {}
  ) {
    const url = new URL(authorization.searchParams.get('redirect_uri')!);
    url.searchParams.set(
      'state',
      options.state ?? authorization.searchParams.get('state')!
    );
    if (options.error) url.searchParams.set('error', options.error);
    else url.searchParams.set('code', 'fixture-code');
    if (
      options.issuedId ??
      authorization.searchParams.get('client_id') === 'dynamic_agent_client'
    )
      url.searchParams.set(
        'client_id',
        options.issuedId ?? 'fixture-issued-client'
      );
    return fetch(url);
  }
  return {
    auth,
    start,
    callback,
    requests,
    fetcher,
    directory,
    settingsPath,
    setSubject(value: string) {
      subject = value;
    },
    setScope(value: string | undefined) {
      scope = value;
    },
    setExchangeFailure(value: boolean) {
      exchangeFailure = value;
    },
    setInvalidGrant(value: boolean) {
      invalidGrant = value;
    },
    setInvalidNonce(value: boolean) {
      invalidNonce = value;
    },
    setInvalidSignature(value: boolean) {
      invalidSignature = value;
    },
    setInvalidIdentity(value: 'issuer' | 'audience' | 'expiry') {
      invalidIdentity = value;
    },
    get refreshCount() {
      return refreshCount;
    },
  };
}

describe('ChatGPT OAuth backend credential isolation', () => {
  test('registers with PKCE and validates state before exchange; persists owner-only credentials', async () => {
    const f = fixture();
    const authorize = await f.start();
    expect(authorize.origin).toBe('https://auth.openai.com');
    expect(authorize.searchParams.get('client_id')).toBe(
      'dynamic_agent_client'
    );
    expect(authorize.searchParams.get('agent_name_hint')).toBe('Nota');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/
    );
    expect((await f.callback({ state: 'attacker-state' })).status).toBe(400);
    expect(f.requests).toHaveLength(0);
    expect((await f.callback()).status).toBe(200);
    expect(f.auth.status()).toMatchObject({
      connected: true,
      planEnabled: true,
      pending: false,
    });
    expect(f.auth.getCachedModels()).toEqual([
      { id: 'fixture-chat', name: 'Fixture chat' },
    ]);
    const file = path.join(f.directory, 'chatgpt-auth/profiles.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(f.auth.status())).not.toContain('fixture-access');
    expect(JSON.stringify(f.auth.status())).not.toContain('fixture-refresh');
    const exchange = f.requests.find(
      request => request.form?.get('grant_type') === 'authorization_code'
    )!;
    expect(exchange.form?.get('client_id')).toBe('fixture-issued-client');
    expect(exchange.form?.get('redirect_uri')).toBe(
      authorize.searchParams.get('redirect_uri')
    );
    const returning = await f.start();
    expect(returning.searchParams.get('client_id')).toBe(
      'fixture-issued-client'
    );
    expect(returning.searchParams.get('ext_agent_host_id')).toBe(
      authorize.searchParams.get('ext_agent_host_id')
    );
    expect(returning.searchParams.has('agent_name_hint')).toBe(false);
    expect(returning.searchParams.has('id_token_hint')).toBe(false);
    const restarted = new ChatGPTAuth(
      { settingsPath: f.settingsPath },
      { fetch: f.fetcher }
    );
    services.push(restarted);
    expect(restarted.status().connected).toBe(true);
    expect(restarted.getCachedModels()).toEqual([
      { id: 'fixture-chat', name: 'Fixture chat' },
    ]);
  });

  test('denial and cancellation preserve the active account and never exchange a denied code', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    const active = f.auth.status().activeProfileId;
    const tokens = f.requests.filter(request =>
      request.url.endsWith('/oauth/token')
    ).length;
    await f.start({ newProfile: true });
    expect((await f.callback({ error: 'access_denied' })).status).toBe(400);
    expect(f.auth.status()).toMatchObject({
      activeProfileId: active,
      connected: true,
      pending: false,
    });
    expect(
      f.requests.filter(request => request.url.endsWith('/oauth/token'))
    ).toHaveLength(tokens);
    await f.start({ newProfile: true });
    f.auth.cancelSignIn();
    expect(f.auth.status()).toMatchObject({
      activeProfileId: active,
      pending: false,
    });
  });

  test.each(['nonce', 'signature'])(
    'rejects invalid signed identity %s',
    async invalid => {
      const f = fixture();
      await f.start();
      if (invalid === 'nonce') f.setInvalidNonce(true);
      else f.setInvalidSignature(true);
      expect((await f.callback()).status).toBe(400);
      expect(f.auth.status().connected).toBe(false);
      expect(f.auth.status().activeProfileId).toBe(null);
    }
  );

  test.each(['issuer', 'audience', 'expiry'] as const)(
    'rejects ID token with invalid %s',
    async invalid => {
      const f = fixture();
      await f.start();
      f.setInvalidIdentity(invalid);
      expect((await f.callback()).status).toBe(400);
      expect(f.auth.status().connected).toBe(false);
    }
  );

  test('retains the issued client registration after failed exchange and rejects changed returning identity', async () => {
    const f = fixture();
    f.setExchangeFailure(true);
    await f.start();
    expect((await f.callback()).status).toBe(400);
    const registered = f.auth.status().profiles[0];
    const retry = await f.start({ profileId: registered.id });
    expect(retry.searchParams.get('client_id')).toBe('fixture-issued-client');
    f.setExchangeFailure(false);
    await f.callback();
    const active = f.auth.status().activeProfileId;
    await f.start();
    f.setSubject('wrong-account');
    expect((await f.callback()).status).toBe(400);
    expect(f.auth.status().activeProfileId).toBe(active);
    expect(await f.auth.getAccessToken()).toBe('fixture-access');
    await f.start();
    expect((await f.callback({ issuedId: 'wrong-client' })).status).toBe(400);
  });

  test('uses granted token scopes rather than successful identity or callback scopes', async () => {
    const f = fixture();
    f.setScope('openid profile email');
    await f.start();
    await f.callback();
    expect(f.auth.status()).toMatchObject({
      connected: true,
      planEnabled: false,
    });
    await expect(f.auth.getAccessToken()).rejects.toThrow(
      'plan usage is not authorized'
    );
    expect(f.auth.getCachedModels()).toEqual([]);
  });

  test('serializes refresh, rotates credentials together, and preserves omitted refresh scope', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    f.setScope(undefined);
    const tokens = await Promise.all([
      f.auth.getAccessToken(true),
      f.auth.getAccessToken(true),
    ]);
    expect(tokens).toEqual([
      'fixture-renewed-access',
      'fixture-renewed-access',
    ]);
    expect(f.refreshCount).toBe(1);
    expect(f.auth.status().planEnabled).toBe(true);
    const saved = JSON.parse(
      readFileSync(path.join(f.directory, 'chatgpt-auth/profiles.json'), 'utf8')
    );
    expect(saved.profiles[0].credentials.refreshToken).toBe(
      'fixture-rotated-refresh'
    );
    expect(
      f.requests
        .find(request => request.form?.get('grant_type') === 'refresh_token')
        ?.form?.has('scope')
    ).toBe(false);
  });

  test('malformed token responses and network errors cannot expose credentials through error messages', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    vi.mocked(f.fetcher).mockImplementationOnce(
      async () =>
        new Response('{"access_token":"fixture-secret-must-stay-private",', {
          status: 200,
        })
    );
    let error: unknown;
    try {
      await f.auth.getAccessToken(true);
    } catch (value) {
      error = value;
    }
    expect(error).toMatchObject({
      message: 'ChatGPT credential renewal failed. Try again.',
    });
    expect(String(error)).not.toContain('fixture-secret');
    expect((error as Error).cause).toBeUndefined();
    vi.mocked(f.fetcher).mockImplementationOnce(async () => {
      throw new Error('Network diagnostic fixture-secret-must-stay-private');
    });
    await expect(f.auth.getAccessToken(true)).rejects.toThrow(
      'ChatGPT credential renewal failed. Try again.'
    );
  });

  test('invalid refresh grant clears only its credentials and model catalog', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    f.setInvalidGrant(true);
    await expect(f.auth.getAccessToken(true)).rejects.toThrow(
      'session expired'
    );
    expect(f.auth.status()).toMatchObject({
      connected: false,
      planEnabled: false,
    });
    expect(f.auth.status().profiles).toHaveLength(1);
    expect(f.auth.getCachedModels()).toEqual([]);
  });

  test('switching registrations refreshes models; sign-out revokes, clears tokens, retains registration', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    const first = f.auth.status().activeProfileId!;
    await f.start({ newProfile: true });
    f.setSubject('second-account');
    await f.callback({ issuedId: 'second-client' });
    expect(f.auth.status().profiles).toHaveLength(2);
    expect(f.auth.status().activeProfileId).not.toBe(first);
    await f.auth.selectProfile(first);
    expect(f.auth.status().activeProfileId).toBe(first);
    await f.auth.signOut();
    expect(f.auth.status()).toMatchObject({
      connected: false,
      planEnabled: false,
    });
    const saved = JSON.parse(
      readFileSync(path.join(f.directory, 'chatgpt-auth/profiles.json'), 'utf8')
    );
    expect(saved.profiles[0].credentials).toBeUndefined();
    expect(saved.profiles[0].clientId).toBe('fixture-issued-client');
    expect(saved.profiles[1].credentials).toBeDefined();
    expect(
      f.requests
        .find(request => request.url.endsWith('/oauth/revoke'))
        ?.form?.get('client_id')
    ).toBe('fixture-issued-client');
  });

  test('account selection succeeds during a catalog outage and preserves its cached choices', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    const first = f.auth.status().activeProfileId!;
    await f.start({ newProfile: true });
    f.setSubject('second-account');
    await f.callback({ issuedId: 'second-client' });
    const second = f.auth.status().activeProfileId!;
    await f.auth.selectProfile(first);
    vi.mocked(f.fetcher).mockResolvedValueOnce(
      Response.json({ error: 'fixture-secret-must-not-leak' }, { status: 503 })
    );
    await expect(f.auth.selectProfile(second)).resolves.toBeUndefined();
    expect(f.auth.status()).toMatchObject({
      activeProfileId: second,
      connected: true,
      error: expect.stringContaining('model catalog is unavailable'),
    });
    expect(f.auth.status().error).not.toContain('fixture-secret');
    expect(f.auth.getCachedModels()).toEqual([
      { id: 'fixture-chat', name: 'Fixture chat' },
    ]);
  });

  test('catalog HTTP 520 is not masked by aborting response-body cleanup', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    let cancelled = false;
    vi.mocked(f.fetcher).mockImplementationOnce(
      async (_input, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
              if (init?.signal?.aborted)
                throw new DOMException(
                  'This operation was aborted',
                  'AbortError'
                );
            },
          }),
          { status: 520, headers: { 'Content-Type': 'text/html' } }
        )
    );
    await expect(f.auth.refreshCatalog()).rejects.toThrow('OpenAI HTTP 520');
    expect(cancelled).toBe(true);
    expect(f.auth.status()).toMatchObject({
      connected: true,
      error: expect.stringContaining('OpenAI HTTP 520'),
    });
    expect(f.auth.getCachedModels()).toEqual([
      { id: 'fixture-chat', name: 'Fixture chat' },
    ]);
    await f.auth.refreshCatalog();
    expect(f.auth.status().error).toBeUndefined();
  });

  test('recovers from HTTP 520 via verified same-email Codex OAuth token and rejects mismatched accounts', async () => {
    const f = fixture();
    const codexAuthPath = path.join(f.directory, 'codex-auth.json');
    const writeCodexAuth = async (email: string) => {
      const accessToken = await new SignJWT({
        'https://api.openai.com/profile': { email },
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct-fixture-codex',
        },
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://auth.openai.com')
        .setAudience('https://api.openai.com/v1')
        .setSubject('codex-subject')
        .setExpirationTime('1h')
        .sign(keys.privateKey);
      writeFileSync(
        codexAuthPath,
        JSON.stringify({
          tokens: {
            access_token: accessToken,
            account_id: 'acct-fixture-codex',
          },
        })
      );
    };
    await f.start();
    await f.callback();
    const authWithFallback = new ChatGPTAuth(
      { settingsPath: f.settingsPath },
      { fetch: f.fetcher, codexAuthPath }
    );
    services.push(authWithFallback);
    await writeCodexAuth('other@example.test');
    vi.mocked(f.fetcher).mockImplementationOnce(
      async () => new Response('Cloudflare 520', { status: 520 })
    );
    await expect(authWithFallback.refreshCatalog()).rejects.toThrow(
      'OpenAI HTTP 520'
    );
    await writeCodexAuth('fixture@example.test');
    vi.mocked(f.fetcher)
      .mockImplementationOnce(
        async () => new Response('Cloudflare 520', { status: 520 })
      )
      .mockImplementationOnce(async (input, init) => {
        expect(String(input)).toBe(
          'https://chatgpt.com/backend-api/codex/models?client_version=0.155.0'
        );
        expect(new Headers(init?.headers).get('ChatGPT-Account-Id')).toBe(
          'acct-fixture-codex'
        );
        return Response.json({
          models: [
            {
              slug: 'gpt-6-sol',
              display_name: 'GPT-6-Sol',
              visibility: 'list',
            },
          ],
        });
      });
    await expect(authWithFallback.refreshCatalog()).resolves.toEqual([
      { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
    ]);
    expect(authWithFallback.status().error).toBeUndefined();
  });

  test.each([
    { name: 'TimeoutError', expected: 'request timed out' },
    { name: 'AbortError', expected: 'request was interrupted' },
    { name: 'Error', expected: 'Could not reach' },
  ])(
    'catalog $name failures are actionable and do not expose network diagnostics',
    async ({ name, expected }) => {
      const f = fixture();
      await f.start();
      await f.callback();
      vi.mocked(f.fetcher).mockRejectedValueOnce(
        Object.assign(new Error('fixture-secret diagnostic'), { name })
      );
      await expect(f.auth.refreshCatalog()).rejects.toThrow(expected);
      expect(f.auth.status().error).not.toContain('fixture-secret');
      expect(f.auth.status().connected).toBe(true);
      expect(f.auth.getCachedModels()).toEqual([
        { id: 'fixture-chat', name: 'Fixture chat' },
      ]);
    }
  );

  test('persisted catalogs remain separate per registration and are cleared on sign-out', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    const first = f.auth.status().activeProfileId!;
    await f.start({ newProfile: true });
    f.setSubject('second-account');
    await f.callback({ issuedId: 'second-client' });
    vi.mocked(f.fetcher).mockResolvedValueOnce(
      Response.json({
        models: [
          { slug: 'second-model', display_name: 'Second', visibility: 'list' },
        ],
      })
    );
    await f.auth.refreshCatalog();
    expect(f.auth.getCachedModels()).toEqual([
      { id: 'second-model', name: 'Second' },
    ]);
    const savedBeforeSwitch = JSON.parse(
      readFileSync(path.join(f.directory, 'chatgpt-auth/profiles.json'), 'utf8')
    );
    expect(savedBeforeSwitch.profiles[0].catalog).toEqual([
      { id: 'fixture-chat', name: 'Fixture chat' },
    ]);
    expect(savedBeforeSwitch.profiles[1].catalog).toEqual([
      { id: 'second-model', name: 'Second' },
    ]);
    await f.auth.selectProfile(first);
    expect(f.auth.getCachedModels()).toEqual([
      { id: 'fixture-chat', name: 'Fixture chat' },
    ]);
    await f.auth.signOut();
    expect(f.auth.getCachedModels()).toEqual([]);
    const restarted = new ChatGPTAuth(
      { settingsPath: f.settingsPath },
      { fetch: f.fetcher }
    );
    services.push(restarted);
    expect(restarted.getCachedModels()).toEqual([]);
  });

  test('sign-out during rotating refresh cannot resurrect credentials', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    const refreshing = expect(f.auth.getAccessToken(true)).rejects.toThrow(
      'account changed'
    );
    await f.auth.signOut();
    await refreshing;
    expect(
      f.requests
        .find(request => request.url.endsWith('/oauth/revoke'))
        ?.form?.get('token')
    ).toBe('fixture-rotated-refresh');
    expect(f.auth.status().connected).toBe(false);
  });

  test('disconnect aborts an in-flight catalog request and prevents stale results restoring models', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    let signal: AbortSignal | null | undefined;
    let finish: (response: Response) => void = () => {};
    vi.mocked(f.fetcher).mockImplementationOnce(async (_input, init) => {
      signal = init?.signal;
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    const rejected = expect(f.auth.refreshCatalog()).rejects.toThrow(
      'account changed'
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    await f.auth.signOut();
    expect(signal!.aborted).toBe(true);
    finish(
      Response.json({
        models: [
          { slug: 'stale-model', display_name: 'Stale', visibility: 'list' },
        ],
      })
    );
    await rejected;
    expect(f.auth.getCachedModels()).toEqual([]);
  });

  test('a token refreshed while switching profiles cannot be returned for the new active account', async () => {
    const f = fixture();
    await f.start();
    await f.callback();
    const first = f.auth.status().activeProfileId!;
    await f.start({ newProfile: true });
    f.setSubject('second-account');
    await f.callback({ issuedId: 'second-client' });
    const second = f.auth.status().activeProfileId!;
    await f.auth.selectProfile(first);
    const rejected = expect(f.auth.getAccessToken(true)).rejects.toThrow(
      'account changed'
    );
    await f.auth.selectProfile(second);
    await rejected;
    expect(f.auth.status()).toMatchObject({
      activeProfileId: second,
      connected: true,
    });
    expect(await f.auth.getAccessToken()).toBe('fixture-access');
  });

  test.each(['malformed-json', 'invalid-profile', 'symlink'] as const)(
    'unsafe %s storage leaves local startup available and refuses overwriting credentials',
    async invalid => {
      const f = fixture();
      const file = path.join(f.directory, 'chatgpt-auth/profiles.json');
      const secret = '{"accessToken":"fixture-secret-preserve",';
      if (invalid === 'malformed-json') writeFileSync(file, secret);
      else if (invalid === 'invalid-profile')
        writeFileSync(
          file,
          JSON.stringify({
            version: 1,
            hostId: 'urn:uuid:1234-abcd',
            profiles: [null],
          })
        );
      else {
        rmSync(file);
        const target = path.join(f.directory, 'fixture-target.json');
        writeFileSync(target, secret);
        symlinkSync(target, file);
      }
      const original = readFileSync(file, 'utf8');
      const auth = new ChatGPTAuth(
        { settingsPath: f.settingsPath },
        { fetch: f.fetcher }
      );
      services.push(auth);
      expect(auth.status()).toMatchObject({
        connected: false,
        profiles: [],
        error: expect.stringContaining('storage is unavailable or unsafe'),
      });
      expect(JSON.stringify(auth.status())).not.toContain('fixture-secret');
      expect(auth.getCachedModels()).toEqual([]);
      await expect(auth.startSignIn()).rejects.toThrow(
        'storage is unavailable or unsafe'
      );
      expect(readFileSync(file, 'utf8')).toBe(original);
    }
  );

  test('expired authorization closes the loopback listener', async () => {
    const f = fixture();
    const auth = new ChatGPTAuth(
      { settingsPath: path.join(f.directory, 'timeout/settings.json') },
      { fetch: f.fetcher, signInTimeoutMs: 10 }
    );
    services.push(auth);
    await auth.startSignIn();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(auth.status()).toMatchObject({
      pending: false,
      error: expect.stringContaining('timed out'),
    });
  });
});
