import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';

import type { AiBackendConfig } from './config';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const CODEX_RESOURCE = 'https://chatgpt.com/backend-api/codex';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_CLIENT_VERSION = '0.155.0';
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const CODEX_TOKEN_URL = `${ISSUER}/oauth/token`;
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const CODEX_INVOKE_SCOPE = 'api.connectors.invoke';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const REQUEST_TIMEOUT = 30_000;

/** A fixed, credential-free message safe for the renderer. */
export class ChatGPTAuthError extends Error {}

interface Credentials {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}
interface Profile {
  id: string;
  label: string;
  clientId: string;
  subject?: string;
  email?: string;
  accountId?: string;
  credentials?: Credentials;
  catalog?: ChatGPTModel[];
}
interface SavedAuth {
  version: 1;
  hostId: string;
  profiles: Profile[];
  activeProfileId?: string;
}
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}
interface PendingSignIn {
  server: Server;
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  profileId: string;
  clientId: string;
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  handling: boolean;
}
export interface ChatGPTModel {
  id: string;
  name: string;
}
export interface ChatGPTAuthStatus {
  connected: boolean;
  planEnabled: boolean;
  pending: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email?: string;
    connected: boolean;
    planEnabled: boolean;
  }[];
  error?: string;
}
/** Injectable network and signed-token verifier for deterministic, credential-free tests. */
export interface ChatGPTAuthDependencies {
  fetch?: typeof fetch;
  verifyIdToken?: (
    token: string,
    clientId: string,
    nonce?: string
  ) => Promise<JWTPayload>;
  signInTimeoutMs?: number;
  codexAuthPath?: string | null;
}

function hasPlanScope(scopes: string[]): boolean {
  return scopes.includes(PLAN_SCOPE) || scopes.includes(CODEX_INVOKE_SCOPE);
}

function extractChatGPTAccountId(
  idToken?: string,
  accessToken?: string
): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) continue;
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) continue;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8')
      ) as Record<string, unknown>;
      if (
        typeof payload.chatgpt_account_id === 'string' &&
        payload.chatgpt_account_id.trim()
      ) {
        return payload.chatgpt_account_id.trim();
      }
      const auth = payload['https://api.openai.com/auth'];
      if (
        auth &&
        typeof auth === 'object' &&
        typeof (auth as Record<string, unknown>).chatgpt_account_id === 'string'
      ) {
        const value = (
          (auth as Record<string, unknown>).chatgpt_account_id as string
        ).trim();
        if (value) return value;
      }
      if (
        Array.isArray(payload.organizations) &&
        payload.organizations[0] &&
        typeof (payload.organizations[0] as { id?: unknown }).id === 'string'
      ) {
        const value = (payload.organizations[0] as { id: string }).id.trim();
        if (value) return value;
      }
    } catch {
      /* Non-JWT synthetic tokens in tests have no embedded claims. */
    }
  }
  return undefined;
}

function codexEndpointUrl(url: string): string {
  return url === `${RESOURCE}/models`
    ? `${CODEX_RESOURCE}/models?client_version=${CODEX_CLIENT_VERSION}`
    : `${CODEX_RESOURCE}/responses`;
}

function isSavedAuth(value: unknown): value is SavedAuth {
  if (!value || typeof value !== 'object') return false;
  const saved = value as SavedAuth;
  if (
    saved.version !== 1 ||
    typeof saved.hostId !== 'string' ||
    !/^urn:uuid:[a-f0-9-]+$/i.test(saved.hostId) ||
    !Array.isArray(saved.profiles)
  )
    return false;
  const ids = new Set<string>();
  for (const profile of saved.profiles) {
    if (
      !profile ||
      typeof profile !== 'object' ||
      typeof profile.id !== 'string' ||
      !profile.id ||
      ids.has(profile.id) ||
      typeof profile.label !== 'string' ||
      typeof profile.clientId !== 'string' ||
      !profile.clientId ||
      profile.clientId === 'dynamic_agent_client'
    )
      return false;
    ids.add(profile.id);
    if (
      (profile.subject !== undefined && typeof profile.subject !== 'string') ||
      (profile.email !== undefined && typeof profile.email !== 'string') ||
      (profile.accountId !== undefined && typeof profile.accountId !== 'string')
    )
      return false;
    const credentials = profile.credentials;
    if (
      credentials &&
      (typeof credentials !== 'object' ||
        typeof profile.subject !== 'string' ||
        !profile.subject ||
        typeof credentials.accessToken !== 'string' ||
        !credentials.accessToken ||
        typeof credentials.idToken !== 'string' ||
        !credentials.idToken ||
        (credentials.refreshToken !== undefined &&
          typeof credentials.refreshToken !== 'string') ||
        !Number.isFinite(credentials.expiresAt) ||
        !Array.isArray(credentials.scopes) ||
        credentials.scopes.some(scope => typeof scope !== 'string'))
    )
      return false;
    if (profile.credentials !== undefined && !credentials) return false;
    if (
      profile.catalog !== undefined &&
      (!Array.isArray(profile.catalog) ||
        profile.catalog.some(
          model =>
            !model ||
            typeof model.id !== 'string' ||
            typeof model.name !== 'string'
        ))
    )
      return false;
  }
  return (
    saved.activeProfileId === undefined ||
    (typeof saved.activeProfileId === 'string' &&
      ids.has(saved.activeProfileId))
  );
}

function equalState(actual: string | null, expected: string) {
  if (actual === null) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function clearCredentials(profile: Profile) {
  delete profile.credentials;
  delete profile.catalog;
}
function credentialsFrom(
  response: TokenResponse,
  previous?: Credentials
): Credentials {
  const idToken = response.id_token || previous?.idToken;
  if (
    typeof response.access_token !== 'string' ||
    !response.access_token ||
    typeof idToken !== 'string' ||
    !idToken ||
    (response.id_token !== undefined &&
      (typeof response.id_token !== 'string' || !response.id_token)) ||
    (response.refresh_token !== undefined &&
      (typeof response.refresh_token !== 'string' ||
        !response.refresh_token)) ||
    typeof response.token_type !== 'string' ||
    response.token_type.toLowerCase() !== 'bearer' ||
    typeof response.expires_in !== 'number' ||
    !Number.isFinite(response.expires_in) ||
    response.expires_in <= 0
  ) {
    throw new ChatGPTAuthError(
      'ChatGPT returned an incomplete credential response. Sign in again.'
    );
  }
  if (response.scope !== undefined && typeof response.scope !== 'string') {
    throw new ChatGPTAuthError(
      'ChatGPT returned invalid granted scopes. Sign in again.'
    );
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token || previous?.refreshToken,
    idToken,
    expiresAt: Date.now() + response.expires_in * 1000,
    // OAuth permits refresh responses to omit scope, retaining the previous grant.
    // A new authorization must explicitly grant plan usage; callback scope is untrusted.
    scopes:
      response.scope === undefined
        ? [...(previous?.scopes ?? [])]
        : response.scope.split(/\s+/).filter(Boolean),
  };
}

/** Tokens are backend-only and live in an atomic owner-only file, never AI settings. */
export class ChatGPTAuth {
  private readonly directory: string;
  private readonly filename: string;
  private readonly fetcher: typeof fetch;
  private readonly verifyIdToken: NonNullable<
    ChatGPTAuthDependencies['verifyIdToken']
  >;
  private readonly signInTimeoutMs: number;
  private readonly codexAuthPath: string | null;
  private readonly saved: SavedAuth;
  private pending?: PendingSignIn;
  private error?: string;
  private readonly storageError?: string;
  private readonly refreshes = new Map<string, Promise<void>>();
  private readonly revisions = new Map<string, number>();
  private readonly revoking = new Map<
    string,
    { credentials: Credentials; refreshToken?: string }
  >();
  private readonly requests = new Set<AbortController>();
  private generation = 0;
  private signInGeneration = 0;

  constructor(
    config: Pick<AiBackendConfig, 'settingsPath'>,
    dependencies: ChatGPTAuthDependencies = {}
  ) {
    this.directory = path.join(
      path.dirname(path.resolve(config.settingsPath)),
      'chatgpt-auth'
    );
    this.filename = path.join(this.directory, 'profiles.json');
    this.fetcher = dependencies.fetch ?? fetch;
    this.signInTimeoutMs = dependencies.signInTimeoutMs ?? 5 * 60_000;
    this.codexAuthPath =
      dependencies.codexAuthPath !== undefined
        ? dependencies.codexAuthPath
        : dependencies.fetch
          ? null
          : path.join(
              process.env.CODEX_HOME?.trim() ||
                path.join(os.homedir(), '.codex'),
              'auth.json'
            );
    this.verifyIdToken =
      dependencies.verifyIdToken ??
      (async (token, clientId, nonce) => {
        const { payload } = await jwtVerify(token, JWKS, {
          issuer: ISSUER,
          audience: clientId,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'exp'],
        });
        if (nonce && payload.nonce !== undefined && payload.nonce !== nonce)
          throw new ChatGPTAuthError(
            'ChatGPT sign-in identity could not be verified.'
          );
        return payload;
      });
    this.saved = {
      version: 1,
      hostId: `urn:uuid:${randomUUID()}`,
      profiles: [],
    };
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      if (
        !lstatSync(this.directory).isDirectory() ||
        lstatSync(this.directory).isSymbolicLink()
      )
        throw new ChatGPTAuthError('ChatGPT credential directory is unsafe.');
      chmodSync(this.directory, 0o700);
      if (existsSync(this.filename)) {
        if (
          !lstatSync(this.filename).isFile() ||
          lstatSync(this.filename).isSymbolicLink()
        )
          throw new ChatGPTAuthError('ChatGPT credential file is unsafe.');
        const saved: unknown = JSON.parse(readFileSync(this.filename, 'utf8'));
        if (!isSavedAuth(saved))
          throw new ChatGPTAuthError('ChatGPT credential storage is invalid.');
        chmodSync(this.filename, 0o600);
        this.saved = saved;
      } else {
        this.persist();
      }
    } catch {
      // Optional ChatGPT credentials must never prevent local Nota from starting.
      // Preserve damaged/unsafe files and deny writes rather than replacing them.
      this.storageError =
        'ChatGPT credential storage is unavailable or unsafe. Restore its file or repair its permissions, then restart Nota before reconnecting.';
      this.saved = {
        version: 1,
        hostId: `urn:uuid:${randomUUID()}`,
        profiles: [],
      };
    }
  }

  private persist() {
    if (this.storageError) throw new ChatGPTAuthError(this.storageError);
    const temporary = path.join(
      this.directory,
      `.profiles-${randomUUID()}.tmp`
    );
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(this.saved));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temporary, this.filename);
      chmodSync(this.filename, 0o600);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  status(): ChatGPTAuthStatus {
    const active = this.activeProfile();
    return {
      connected: !!active?.credentials,
      planEnabled: !!(
        active?.credentials && hasPlanScope(active.credentials.scopes)
      ),
      pending: !!this.pending,
      activeProfileId: this.saved.activeProfileId ?? null,
      profiles: this.saved.profiles.map(profile => ({
        id: profile.id,
        label: profile.label,
        ...(profile.email ? { email: profile.email } : {}),
        connected: !!profile.credentials,
        planEnabled: !!(
          profile.credentials && hasPlanScope(profile.credentials.scopes)
        ),
      })),
      ...(this.storageError || this.error
        ? { error: this.storageError ?? this.error }
        : {}),
    };
  }
  /** Monotonic backend session identity; binds every agent turn to one account. */
  getSessionVersion(): number {
    return this.generation;
  }

  getCachedModels(): ChatGPTModel[] {
    const profile = this.activeProfile();
    if (!profile?.credentials || !hasPlanScope(profile.credentials.scopes))
      return [];
    return (profile.catalog ?? []).map(model => ({
      id: model.id,
      name: model.name,
    }));
  }
  private activeProfile() {
    return this.saved.profiles.find(
      profile => profile.id === this.saved.activeProfileId
    );
  }
  private stopRequests() {
    this.generation++;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }

  async startSignIn(
    options: { profileId?: string; newProfile?: boolean } = {}
  ): Promise<{ url: string; profileId: string }> {
    if (this.storageError) throw new ChatGPTAuthError(this.storageError);
    this.cancelSignIn();
    const signInGeneration = this.signInGeneration;
    this.error = undefined;
    const profile = options.newProfile
      ? undefined
      : this.saved.profiles.find(
          profile =>
            profile.id === (options.profileId ?? this.saved.activeProfileId)
        );
    if (options.profileId && !profile && !options.newProfile)
      throw new ChatGPTAuthError('Unknown ChatGPT account.');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    if (signInGeneration !== this.signInGeneration) {
      server.close();
      throw new ChatGPTAuthError('ChatGPT sign-in was cancelled.');
    }
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new ChatGPTAuthError('Unable to start ChatGPT sign-in callback.');
    }
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url');
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const controller = new AbortController();
    const pending: PendingSignIn = {
      server,
      state,
      nonce,
      verifier,
      redirectUri,
      controller,
      profileId: profile?.id ?? randomUUID(),
      clientId: profile?.clientId ?? 'dynamic_agent_client',
      timeout: setTimeout(() => {
        if (this.pending === pending) {
          this.cancelSignIn();
          this.error = 'ChatGPT sign-in timed out. Try again.';
        }
      }, this.signInTimeoutMs),
      handling: false,
    };
    pending.timeout.unref();
    server.unref();
    this.pending = pending;
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
        response.writeHead(404).end();
        return;
      }
      if (!equalState(url.searchParams.get('state'), state)) {
        response.writeHead(400).end('Invalid sign-in state.');
        return;
      }
      if (pending.handling || this.pending !== pending) {
        response.writeHead(409).end('Sign-in is no longer pending.');
        return;
      }
      pending.handling = true;
      void this.completeSignIn(pending, url)
        .then(() => {
          response
            .writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            .end('ChatGPT sign-in complete. Return to Nota.');
        })
        .catch(() => {
          if (this.pending === pending && !controller.signal.aborted)
            this.error =
              'ChatGPT sign-in was denied or could not be validated. Try again.';
          response
            .writeHead(400, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            .end(
              'ChatGPT sign-in could not be completed. Return to Nota and try again.'
            );
        })
        .finally(() => {
          if (this.pending === pending) this.finishSignIn(pending);
        });
    });
    const authorize = new URL(`${ISSUER}/api/accounts/authorize`);
    authorize.search = new URLSearchParams({
      client_id: pending.clientId,
      ext_agent_host_id: this.saved.hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      ...(profile
        ? profile.email
          ? { login_hint: profile.email }
          : {}
        : { agent_name_hint: 'Nota' }),
      // Deliberately omit id_token_hint: this URL crosses the renderer boundary.
      // OpenAI supports reauthorization with its account selector instead.
    }).toString();
    return { url: authorize.toString(), profileId: pending.profileId };
  }

  private finishSignIn(pending: PendingSignIn) {
    clearTimeout(pending.timeout);
    pending.server.close();
    pending.server.closeIdleConnections();
    if (this.pending === pending) this.pending = undefined;
  }
  cancelSignIn() {
    this.signInGeneration++;
    if (!this.pending) return;
    this.pending.controller.abort();
    this.finishSignIn(this.pending);
  }
  private async completeSignIn(pending: PendingSignIn, callback: URL) {
    if (callback.searchParams.has('error'))
      throw new ChatGPTAuthError('ChatGPT authorization denied.');
    const issuedId = callback.searchParams.get('client_id');
    if (pending.clientId === 'dynamic_agent_client') {
      if (!issuedId || issuedId === 'dynamic_agent_client')
        throw new ChatGPTAuthError('ChatGPT registration is incomplete.');
      pending.clientId = issuedId;
      this.saved.profiles.push({
        id: pending.profileId,
        label: `ChatGPT account ${this.saved.profiles.length + 1}`,
        clientId: issuedId,
      });
      // Keep registration even when code exchange fails; retry uses the issued ID.
      this.persist();
    } else if (issuedId && issuedId !== pending.clientId) {
      throw new ChatGPTAuthError('ChatGPT returned a different registration.');
    }
    const code = callback.searchParams.get('code');
    if (!code)
      throw new ChatGPTAuthError('ChatGPT authorization code is missing.');
    const token = await this.tokenRequest(
      {
        grant_type: 'authorization_code',
        client_id: pending.clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource: RESOURCE,
      },
      pending.controller.signal
    );
    if (!token.id_token)
      throw new ChatGPTAuthError('ChatGPT returned no ID token.');
    const identity = await this.verifyIdToken(
      token.id_token,
      pending.clientId,
      pending.nonce
    );
    if (
      !identity.sub ||
      this.pending !== pending ||
      pending.controller.signal.aborted
    )
      throw new ChatGPTAuthError('ChatGPT sign-in was cancelled.');
    const profile = this.saved.profiles.find(
      profile => profile.id === pending.profileId
    );
    if (!profile) throw new ChatGPTAuthError('ChatGPT sign-in was cancelled.');
    if (profile.subject && profile.subject !== identity.sub)
      throw new ChatGPTAuthError('ChatGPT returned a different account.');
    const credentials = credentialsFrom(token);
    profile.subject = identity.sub;
    profile.email =
      typeof identity.email === 'string' ? identity.email : undefined;
    profile.accountId = extractChatGPTAccountId(
      credentials.idToken,
      credentials.accessToken
    );
    profile.credentials = credentials;
    delete profile.catalog;
    this.stopRequests();
    this.saved.activeProfileId = profile.id;
    this.revisions.set(profile.id, (this.revisions.get(profile.id) ?? 0) + 1);
    this.error = hasPlanScope(credentials.scopes)
      ? undefined
      : 'ChatGPT plan usage was not authorized. Reconnect and allow plan access.';
    this.persist();
    if (hasPlanScope(credentials.scopes)) {
      // Catalog outages must not undo a validated sign-in. refreshCatalog
      // records its safe error only while this account is still active.
      await this.refreshCatalog().catch(() => {});
    }
  }

  private async tokenRequest(
    parameters: Record<string, string>,
    signal?: AbortSignal,
    endpoint = TOKEN_URL
  ): Promise<TokenResponse> {
    let response: Response;
    let result: TokenResponse;
    try {
      response = await this.fetcher(endpoint, {
        redirect: 'error',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)])
          : AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      result = (await response.json()) as TokenResponse;
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new Error('Invalid response.');
    } catch {
      // Fetch/JSON errors can contain raw response excerpts. Never propagate a
      // token-bearing body, a network error object, or its cause to the renderer.
      throw new ChatGPTAuthError(
        'ChatGPT credential renewal failed. Try again.'
      );
    }
    if (!response.ok || result.error) {
      // Never include the raw OAuth response or token endpoint body in errors.
      const error = new ChatGPTAuthError(
        result.error === 'invalid_grant'
          ? 'ChatGPT session expired. Sign in again.'
          : 'ChatGPT credential renewal failed. Try again.'
      );
      Object.assign(error, { invalidGrant: result.error === 'invalid_grant' });
      throw error;
    }
    return result;
  }

  async selectProfile(profileId: string) {
    if (!this.saved.profiles.some(profile => profile.id === profileId))
      throw new ChatGPTAuthError('Unknown ChatGPT account.');
    this.cancelSignIn();
    this.stopRequests();
    this.saved.activeProfileId = profileId;
    this.error = undefined;
    this.persist();
    if (this.status().planEnabled) {
      // Selection succeeds independently from optional catalog availability.
      // refreshCatalog preserves saved choices and records the safe error.
      await this.refreshCatalog().catch(() => {});
    }
  }

  private async refresh(profile: Profile, force = false) {
    const existing = this.refreshes.get(profile.id);
    if (existing) return existing;
    if (
      !profile.credentials ||
      (!force && profile.credentials.expiresAt > Date.now() + 60_000)
    )
      return;
    const credentials = profile.credentials;
    const revision = this.revisions.get(profile.id) ?? 0;
    const refreshToken = credentials.refreshToken;
    if (!refreshToken) {
      clearCredentials(profile);
      this.persist();
      throw new ChatGPTAuthError('ChatGPT session expired. Sign in again.');
    }
    const refreshing = (async () => {
      try {
        const isCodexClient = profile.clientId === CODEX_CLIENT_ID;
        const token = await this.tokenRequest(
          {
            grant_type: 'refresh_token',
            client_id: profile.clientId,
            refresh_token: refreshToken,
            ...(isCodexClient ? {} : { resource: RESOURCE }),
          },
          undefined,
          isCodexClient ? CODEX_TOKEN_URL : TOKEN_URL
        );
        if (token.id_token) {
          let identity: JWTPayload;
          try {
            identity = await this.verifyIdToken(
              token.id_token,
              profile.clientId
            );
          } catch {
            throw new ChatGPTAuthError(
              'ChatGPT identity could not be validated. Sign in again.'
            );
          }
          if (identity.sub !== profile.subject)
            throw new ChatGPTAuthError(
              'ChatGPT refresh returned a different account.'
            );
        }
        const renewed = credentialsFrom(token, credentials);
        const revoking = this.revoking.get(profile.id);
        if (revoking?.credentials === credentials)
          revoking.refreshToken = renewed.refreshToken;
        if (
          (this.revisions.get(profile.id) ?? 0) !== revision ||
          profile.credentials !== credentials
        )
          throw new ChatGPTAuthError('ChatGPT account changed during renewal.');
        profile.credentials = renewed;
        profile.accountId =
          extractChatGPTAccountId(renewed.idToken, renewed.accessToken) ??
          profile.accountId;
        this.persist();
      } catch (error) {
        if (
          (error as { invalidGrant?: boolean }).invalidGrant &&
          profile.credentials === credentials
        ) {
          clearCredentials(profile);
          this.revisions.set(profile.id, revision + 1);
          this.persist();
          if (this.saved.activeProfileId === profile.id) {
            this.stopRequests();
            this.error = 'ChatGPT session expired. Sign in again.';
          }
        }
        throw error;
      }
    })();
    this.refreshes.set(profile.id, refreshing);
    try {
      await refreshing;
    } finally {
      if (this.refreshes.get(profile.id) === refreshing)
        this.refreshes.delete(profile.id);
    }
  }

  /** Backend-only. Never expose this method through settings/status routes. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    const profile = this.activeProfile();
    const generation = this.generation;
    if (!profile?.credentials)
      throw new ChatGPTAuthError('Continue with ChatGPT in AI Settings first.');
    await this.refresh(profile, forceRefresh);
    if (
      generation !== this.generation ||
      profile !== this.activeProfile() ||
      !profile.credentials
    )
      throw new ChatGPTAuthError(
        'ChatGPT account changed. Retry your request.'
      );
    if (!hasPlanScope(profile.credentials.scopes))
      throw new ChatGPTAuthError(
        'ChatGPT plan usage is not authorized. Reconnect and allow plan access.'
      );
    return profile.credentials.accessToken;
  }

  private async readLocalCodexFallback(
    profile: Profile
  ): Promise<{ accessToken: string; accountId: string } | null> {
    if (!this.codexAuthPath || !profile.email) return null;
    try {
      if (
        !existsSync(this.codexAuthPath) ||
        lstatSync(this.codexAuthPath).isSymbolicLink() ||
        !lstatSync(this.codexAuthPath).isFile()
      )
        return null;
      const parsed = JSON.parse(readFileSync(this.codexAuthPath, 'utf8')) as {
        tokens?: {
          access_token?: unknown;
          id_token?: unknown;
          account_id?: unknown;
        };
      };
      const accessToken = parsed.tokens?.access_token;
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const identity = await this.verifyIdToken(accessToken, RESOURCE);
      const profileClaim =
        identity['https://api.openai.com/profile'] &&
        typeof identity['https://api.openai.com/profile'] === 'object'
          ? (identity['https://api.openai.com/profile'] as Record<
              string,
              unknown
            >)
          : undefined;
      const email =
        typeof identity.email === 'string'
          ? identity.email
          : typeof profileClaim?.email === 'string'
            ? profileClaim.email
            : undefined;
      if (!email || email.toLowerCase() !== profile.email.toLowerCase())
        return null;
      const accountId =
        (typeof parsed.tokens?.account_id === 'string' &&
          parsed.tokens.account_id.trim()) ||
        extractChatGPTAccountId(
          typeof parsed.tokens?.id_token === 'string'
            ? parsed.tokens.id_token
            : undefined,
          accessToken
        );
      if (!accountId) return null;
      return { accessToken, accountId };
    } catch {
      return null;
    }
  }

  /** Only approved public API endpoints; disconnect/account switching abort requests. */
  async fetchAuthorized(
    url: string,
    init: RequestInit = {}
  ): Promise<Response> {
    if (url !== `${RESOURCE}/models` && url !== `${RESOURCE}/responses`)
      throw new ChatGPTAuthError('Unsupported ChatGPT API endpoint.');
    const generation = this.generation;
    const profile = this.activeProfile();
    const controller = new AbortController();
    this.requests.add(controller);
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    try {
      const token = await this.getAccessToken();
      if (generation !== this.generation)
        throw new ChatGPTAuthError('ChatGPT account changed.');
      const accountId =
        profile?.accountId ??
        extractChatGPTAccountId(profile?.credentials?.idToken, token);
      const targetUrl = accountId ? codexEndpointUrl(url) : url;
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      if (accountId) headers.set('ChatGPT-Account-Id', accountId);
      let response = await this.fetcher(targetUrl, {
        ...init,
        headers,
        signal,
        redirect: 'error',
      });
      if (
        response.status === 401 &&
        generation === this.generation &&
        !signal.aborted
      ) {
        await response.body?.cancel();
        headers.set(
          'Authorization',
          `Bearer ${await this.getAccessToken(true)}`
        );
        if (generation !== this.generation || signal.aborted)
          throw new ChatGPTAuthError('ChatGPT account changed.');
        response = await this.fetcher(targetUrl, {
          ...init,
          headers,
          signal,
          redirect: 'error',
        });
      }
      if (
        response.status === 520 &&
        !accountId &&
        profile &&
        generation === this.generation &&
        !signal.aborted
      ) {
        const fallback = await this.readLocalCodexFallback(profile);
        if (fallback && generation === this.generation && !signal.aborted) {
          await response.body?.cancel().catch(() => {});
          const fallbackHeaders = new Headers(init.headers);
          fallbackHeaders.set(
            'Authorization',
            `Bearer ${fallback.accessToken}`
          );
          fallbackHeaders.set('ChatGPT-Account-Id', fallback.accountId);
          response = await this.fetcher(codexEndpointUrl(url), {
            ...init,
            headers: fallbackHeaders,
            signal,
            redirect: 'error',
          });
        }
      }
      if (generation !== this.generation || signal.aborted) {
        await response.body?.cancel();
        throw new ChatGPTAuthError('ChatGPT account changed.');
      }
      if (!response.body) {
        this.requests.delete(controller);
        return response;
      }
      // Retain abort control until the streamed body is consumed, not just headers.
      const reader = response.body.getReader();
      const requests = this.requests;
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const item = await reader.read();
            if (item.done) {
              requests.delete(controller);
              stream.close();
            } else stream.enqueue(item.value);
          } catch (error) {
            requests.delete(controller);
            stream.error(error);
          }
        },
        async cancel(reason) {
          requests.delete(controller);
          // Cancel the reader before aborting its fetch: aborting first can
          // make native fetch reject cancellation with AbortError, obscuring
          // an upstream HTTP error such as the catalog's Cloudflare 520.
          try {
            await reader.cancel(reason);
          } catch {
            /* Cleanup must not replace the original request failure. */
          } finally {
            controller.abort();
          }
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      this.requests.delete(controller);
      throw error;
    }
  }

  async refreshCatalog(): Promise<ChatGPTModel[]> {
    const generation = this.generation;
    const profile = this.activeProfile();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT);
    try {
      const response = await this.fetchAuthorized(`${RESOURCE}/models`, {
        signal: timeout,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const recovery =
          response.status === 401 || response.status === 403
            ? "Reconnect ChatGPT and check this account's app permissions."
            : 'Your sign-in is saved. Retry Refresh models.';
        throw new ChatGPTAuthError(
          `ChatGPT model catalog is unavailable (OpenAI HTTP ${response.status}). ${recovery}`
        );
      }
      const data = (await response.json()) as {
        models?: {
          slug?: string;
          display_name?: string;
          visibility?: string;
        }[];
      } | null;
      if (!data || !Array.isArray(data.models))
        throw new ChatGPTAuthError(
          'ChatGPT returned an invalid model catalog.'
        );
      const models = data.models.flatMap(model =>
        model &&
        model.visibility === 'list' &&
        typeof model.slug === 'string' &&
        typeof model.display_name === 'string'
          ? [{ id: model.slug, name: model.display_name }]
          : []
      );
      if (
        generation !== this.generation ||
        !profile ||
        profile !== this.activeProfile() ||
        !profile.credentials
      )
        throw new ChatGPTAuthError(
          'ChatGPT account changed while loading models.'
        );
      profile.catalog = models;
      this.persist();
      this.error = undefined;
      return this.getCachedModels();
    } catch (error) {
      const name = error instanceof Error ? error.name : undefined;
      const safe =
        error instanceof ChatGPTAuthError
          ? error
          : generation !== this.generation
            ? new ChatGPTAuthError(
                'ChatGPT account changed while loading models.'
              )
            : timeout.aborted || name === 'TimeoutError'
              ? new ChatGPTAuthError(
                  'ChatGPT model catalog request timed out. Check your connection and retry Refresh models.'
                )
              : name === 'AbortError'
                ? new ChatGPTAuthError(
                    'ChatGPT model catalog request was interrupted. Retry Refresh models.'
                  )
                : name === 'SyntaxError'
                  ? new ChatGPTAuthError(
                      'ChatGPT returned an invalid model catalog.'
                    )
                  : new ChatGPTAuthError(
                      'Could not reach the ChatGPT model catalog. Check your connection and retry Refresh models.'
                    );
      if (generation === this.generation && profile === this.activeProfile())
        this.error = safe.message;
      throw safe;
    }
  }

  async signOut() {
    this.cancelSignIn();
    const profile = this.activeProfile();
    const credentials = profile?.credentials;
    const revoking = credentials
      ? { credentials, refreshToken: credentials.refreshToken }
      : undefined;
    const refreshing = profile ? this.refreshes.get(profile.id) : undefined;
    if (profile && revoking) this.revoking.set(profile.id, revoking);
    const clientId = profile?.clientId;
    this.stopRequests();
    const generation = this.generation;
    if (profile) {
      clearCredentials(profile);
      this.revisions.set(profile.id, (this.revisions.get(profile.id) ?? 0) + 1);
    }
    this.error = undefined;
    this.persist();
    // Wait for any already-issued rotation after stopping inference and clearing
    // disk credentials. Revoke its latest token without resurrecting the session.
    await refreshing?.catch(() => {});
    if (profile && this.revoking.get(profile.id) === revoking)
      this.revoking.delete(profile.id);
    const refreshToken = revoking?.refreshToken;
    if (!refreshToken || !clientId) return;
    // The published discovery document supplies the revocation endpoint. Never
    // send credentials to an arbitrary discovery URL or an off-origin endpoint.
    try {
      const discovery = await this.fetcher(
        `${ISSUER}/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT) }
      );
      if (!discovery.ok) throw new ChatGPTAuthError('Discovery unavailable.');
      const metadata = (await discovery.json()) as {
        revocation_endpoint?: string;
      };
      const endpoint = new URL(metadata.revocation_endpoint ?? '');
      if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password)
        throw new ChatGPTAuthError('Invalid revocation endpoint.');
      let revoked = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.fetcher(endpoint, {
            redirect: 'error',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: refreshToken,
              token_type_hint: 'refresh_token',
              client_id: clientId,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
          });
          if (response.status === 200) {
            revoked = true;
            break;
          }
          if (response.status < 500) break;
        } catch {
          /* Retry a transient failure once while the token remains in memory. */
        }
        if (attempt === 0)
          await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!revoked) throw new ChatGPTAuthError('Revocation unavailable.');
    } catch {
      if (generation === this.generation) {
        this.error =
          'Signed out locally. Remote revocation was not confirmed; disconnect Nota in ChatGPT Settings if needed.';
      }
    }
  }
}

const services = new Map<string, ChatGPTAuth>();
export function getChatGPTAuth(
  config: Pick<AiBackendConfig, 'settingsPath'>
): ChatGPTAuth {
  const key = path.resolve(config.settingsPath);
  let service = services.get(key);
  if (!service) {
    service = new ChatGPTAuth(config);
    services.set(key, service);
  }
  return service;
}
