import { Service } from '@nota/infra';

import type { UrlService } from '../../url';
import type { GoogleTokens, GoogleUserInfo } from '../entities/google-session';
import { GoogleSession } from '../entities/google-session';

const GOOGLE_OAUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 41013;
const LOOPBACK_FLOW_QUERY_PARAM = 'nota_flow';
const CODE_STORAGE_KEY = 'nota-google-auth-code';

interface AuthCallbackResult {
  brokerCode?: string;
  code?: string;
  error?: string;
  flowId?: string;
}

type AuthFlow = {
  flowId?: string;
  registeredLoopback: boolean;
  redirectUri: string;
};

type ElectronGoogleAuthApi = {
  beginLoopbackFlow(): Promise<{ flowId: string; redirectUri: string }>;
  cancelLoopbackFlow(flowId: string): Promise<unknown>;
  pollLoopbackFlow(flowId: string): Promise<AuthCallbackResult | null>;
};

interface BrokerTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  scopes?: string[];
  userInfo: GoogleUserInfo;
}

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sha256(message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(payload);
  return JSON.parse(decoded) as Record<string, unknown>;
}

export class GoogleAuthService extends Service {
  readonly session = this.framework.createEntity(GoogleSession);

  private activeConnectController: AbortController | null = null;
  private activeLoopbackFlowId: string | null = null;
  private connectGeneration = 0;

  constructor(private readonly urlService: UrlService) {
    super();
  }

  async connect(): Promise<void> {
    const generation = ++this.connectGeneration;
    this.activeConnectController?.abort();
    const previousFlowId = this.activeLoopbackFlowId;
    this.activeLoopbackFlowId = null;
    if (previousFlowId) {
      this.cancelLoopbackFlow(previousFlowId).catch(() => undefined);
    }

    const controller = new AbortController();
    this.activeConnectController = controller;
    this.session.setConnecting();
    let flow: AuthFlow | null = null;

    try {
      flow = await this.beginAuthFlow();
      this.assertCurrentConnect(generation, controller.signal);
      if (flow.registeredLoopback && flow.flowId) {
        this.activeLoopbackFlowId = flow.flowId;
      }

      const brokerUrl = normalizeBrokerUrl(BUILD_CONFIG.googleAuthBrokerUrl);

      if (brokerUrl) {
        await this.connectWithBroker(brokerUrl, flow, controller.signal);
      } else {
        await this.connectDirectly(flow, controller.signal);
      }
      this.assertCurrentConnect(generation, controller.signal);
    } catch (err) {
      if (generation === this.connectGeneration && !controller.signal.aborted) {
        this.session.status$.next('error');
      }
      throw err;
    } finally {
      if (flow?.registeredLoopback && flow.flowId) {
        await this.cancelLoopbackFlow(flow.flowId);
      }
      if (generation === this.connectGeneration) {
        this.activeConnectController = null;
        this.activeLoopbackFlowId = null;
      }
    }
  }

  private assertCurrentConnect(generation: number, signal: AbortSignal) {
    if (generation !== this.connectGeneration || signal.aborted) {
      throw (
        signal.reason ?? new DOMException('OAuth flow cancelled', 'AbortError')
      );
    }
  }

  private async beginAuthFlow(): Promise<AuthFlow> {
    if (BUILD_CONFIG.isElectron) {
      const api = this.getElectronGoogleAuthApi();
      if (!api) {
        throw new Error('Nota OAuth bridge is unavailable');
      }
      const flow = await api.beginLoopbackFlow();
      return { ...flow, registeredLoopback: true };
    }

    return {
      // Keep the legacy native loopback protocol unchanged. Web callbacks use
      // standard OAuth state to bind the popup/localStorage result.
      flowId: BUILD_CONFIG.isNative
        ? undefined
        : base64urlEncode(generateRandomBytes(32)),
      redirectUri: this.getRedirectUri(),
      registeredLoopback: false,
    };
  }

  private getElectronGoogleAuthApi(): ElectronGoogleAuthApi | null {
    return (
      (
        globalThis as {
          __apis?: { googleAuth?: ElectronGoogleAuthApi };
        }
      ).__apis?.googleAuth ?? null
    );
  }

  private async cancelLoopbackFlow(flowId: string) {
    try {
      await this.getElectronGoogleAuthApi()?.cancelLoopbackFlow(flowId);
    } catch (error) {
      console.warn('[GoogleAuth] Failed to clear OAuth loopback flow:', error);
    }
  }

  private getRedirectUri(): string {
    const usesLoopbackRedirect =
      BUILD_CONFIG.isElectron || BUILD_CONFIG.isNative;
    return usesLoopbackRedirect
      ? `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/auth/callback`
      : `${window.location.origin}/auth/callback`;
  }

  private async connectWithBroker(
    brokerUrl: string,
    flow: AuthFlow,
    signal: AbortSignal
  ): Promise<void> {
    const redirectUri = flow.flowId
      ? appendOAuthFlowToRedirect(flow.redirectUri, flow.flowId)
      : flow.redirectUri;
    const authUrl = new URL('/api/google/start', brokerUrl);
    authUrl.searchParams.set('redirect_uri', redirectUri);

    localStorage.removeItem(CODE_STORAGE_KEY);

    this.openOAuthWindow(authUrl.toString());

    const result = await this.waitForAuthResult(flow, signal);
    if (!result.brokerCode) {
      throw new Error('No broker authorization code received');
    }

    await this.redeemBrokerCode(brokerUrl, result.brokerCode, signal);
  }

  private async connectDirectly(
    flow: AuthFlow,
    signal: AbortSignal
  ): Promise<void> {
    if (!BUILD_CONFIG.googleClientId) {
      throw new Error('Google OAuth client ID is missing');
    }

    const redirectUri = flow.redirectUri;

    const verifierBytes = generateRandomBytes(32);
    const codeVerifier = base64urlEncode(verifierBytes);

    const challengeBytes = await sha256(codeVerifier);
    const codeChallenge = base64urlEncode(challengeBytes);

    const authParams = new URLSearchParams({
      client_id: BUILD_CONFIG.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      ...(flow.flowId ? { state: flow.flowId } : {}),
    });

    const authUrl = `${GOOGLE_OAUTH_ENDPOINT}?${authParams.toString()}`;

    localStorage.removeItem(CODE_STORAGE_KEY);

    this.openOAuthWindow(authUrl);

    const result = await this.waitForAuthResult(flow, signal);
    if (!result.code) {
      throw new Error('No authorization code received');
    }

    await this.exchangeCodeForTokens(
      result.code,
      redirectUri,
      codeVerifier,
      signal
    );
  }

  private openOAuthWindow(authUrl: string): void {
    if (BUILD_CONFIG.isElectron || BUILD_CONFIG.isNative) {
      this.urlService.openExternal(authUrl);
      return;
    }

    const popup = window.open(
      authUrl,
      'google-oauth',
      'width=500,height=600,scrollbars=yes,resizable=yes'
    );

    if (!popup) {
      this.urlService.openExternal(authUrl);
    }
  }

  private waitForAuthResult(
    flow: AuthFlow,
    signal: AbortSignal
  ): Promise<AuthCallbackResult> {
    return new Promise<AuthCallbackResult>((resolve, reject) => {
      let isPollingLoopback = false;
      let settled = false;
      const expectedFlowId = flow.flowId;
      const shouldPollElectron =
        flow.registeredLoopback && Boolean(expectedFlowId);
      const shouldPollNative = BUILD_CONFIG.isNative;

      const finish = (result?: AuthCallbackResult, error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        if (!result) {
          reject(new Error('No auth result received'));
          return;
        }
        localStorage.removeItem(CODE_STORAGE_KEY);
        if (result.error) {
          reject(new Error(`OAuth error: ${result.error}`));
        } else if (result.code || result.brokerCode) {
          resolve(result);
        } else {
          reject(new Error('No auth result received'));
        }
      };

      const timeout = setTimeout(
        () => {
          finish(undefined, new Error('OAuth timeout'));
        },
        5 * 60 * 1000
      );

      const onMessage = (event: MessageEvent) => {
        if (
          !BUILD_CONFIG.isElectron &&
          event.origin !== window.location.origin
        ) {
          return;
        }
        const result = parseAuthResult(event.data, expectedFlowId);
        if (result) {
          finish(result);
        }
      };

      const storagePoll = shouldPollElectron
        ? null
        : setInterval(() => {
            const storedResult = readStoredAuthResult(expectedFlowId);
            if (storedResult) {
              finish(storedResult);
            }
          }, 500);

      const loopbackPoll =
        shouldPollElectron || shouldPollNative
          ? setInterval(() => {
              if (isPollingLoopback) return;
              isPollingLoopback = true;
              const poll = shouldPollElectron
                ? this.pollElectronLoopbackAuthResult(expectedFlowId as string)
                : pollNativeLoopbackAuthResult();
              void poll
                .then(result => {
                  if (!result) return;
                  finish(result);
                })
                .catch(() => {
                  // Ignore transient loopback failures while the OAuth window is open.
                })
                .finally(() => {
                  isPollingLoopback = false;
                });
            }, 500)
          : null;

      const cleanup = () => {
        clearTimeout(timeout);
        if (storagePoll) clearInterval(storagePoll);
        if (loopbackPoll) clearInterval(loopbackPoll);
        signal.removeEventListener('abort', onAbort);
        if (!shouldPollElectron) {
          window.removeEventListener('message', onMessage);
        }
      };

      const onAbort = () => {
        const reason = signal.reason;
        finish(
          undefined,
          reason instanceof Error
            ? reason
            : new DOMException('OAuth flow cancelled', 'AbortError')
        );
      };

      signal.addEventListener('abort', onAbort, { once: true });
      if (!shouldPollElectron) {
        window.addEventListener('message', onMessage);
      }
      if (signal.aborted) onAbort();
    });
  }

  private async pollElectronLoopbackAuthResult(flowId: string) {
    const api = this.getElectronGoogleAuthApi();
    if (!api) throw new Error('Nota OAuth bridge is unavailable');
    return api.pollLoopbackFlow(flowId);
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier: string,
    signal: AbortSignal
  ): Promise<void> {
    const tokenParams = new URLSearchParams({
      client_id: BUILD_CONFIG.googleClientId,
      ...(BUILD_CONFIG.googleClientSecret
        ? { client_secret: BUILD_CONFIG.googleClientSecret }
        : {}),
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
      signal,
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      throw new Error(
        `Token exchange failed: ${tokenResponse.status} ${errBody}`
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
      scope?: string;
    };

    if (!tokenData.refresh_token) {
      throw new Error('No refresh_token received from Google');
    }

    const tokens: GoogleTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      refreshMode: 'google',
      scopes: parseScopeString(tokenData.scope) ?? SCOPES.split(' '),
    };

    let userInfo: GoogleUserInfo;
    if (tokenData.id_token) {
      const payload = decodeJwtPayload(tokenData.id_token);
      userInfo = {
        sub: payload['sub'] as string,
        email: payload['email'] as string,
        name: payload['name'] as string,
        picture: payload['picture'] as string | undefined,
      };
    } else {
      throw new Error('No id_token in token response');
    }

    signal.throwIfAborted();
    await this.session.setTokens(tokens, userInfo);
  }

  private async redeemBrokerCode(
    brokerUrl: string,
    brokerCode: string,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${brokerUrl}/api/google/redeem-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: brokerCode }),
      signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `Broker token exchange failed: ${response.status} ${errBody}`
      );
    }

    const tokenData = (await response.json()) as BrokerTokenResponse;

    const tokens: GoogleTokens = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: Date.now() + tokenData.expiresIn * 1000,
      refreshMode: 'broker',
      authBrokerUrl: brokerUrl,
      scopes: tokenData.scopes,
    };

    signal.throwIfAborted();
    await this.session.setTokens(tokens, tokenData.userInfo);
  }

  async disconnect(): Promise<void> {
    this.connectGeneration += 1;
    this.activeConnectController?.abort();
    this.activeConnectController = null;
    const flowId = this.activeLoopbackFlowId;
    this.activeLoopbackFlowId = null;
    if (flowId) {
      this.cancelLoopbackFlow(flowId).catch(() => undefined);
    }
    await this.session.clear();
  }
}

async function pollNativeLoopbackAuthResult(): Promise<AuthCallbackResult | null> {
  const response = await fetch(
    `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/auth/poll`,
    {
      cache: 'no-store',
    }
  );

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Loopback auth poll failed: ${response.status}`);
  }

  const result = (await response.json()) as AuthCallbackResult;
  return result;
}

function parseAuthResult(
  data: unknown,
  expectedFlowId?: string
): AuthCallbackResult | null {
  if (!data || typeof data !== 'object') return null;

  const maybeResult = data as {
    brokerCode?: unknown;
    code?: unknown;
    error?: unknown;
    flowId?: unknown;
    type?: unknown;
  };

  if (maybeResult.type !== 'google-auth-callback') return null;
  const flowId =
    typeof maybeResult.flowId === 'string' ? maybeResult.flowId : undefined;
  if (expectedFlowId && flowId !== expectedFlowId) return null;

  return {
    brokerCode:
      typeof maybeResult.brokerCode === 'string'
        ? maybeResult.brokerCode
        : undefined,
    code: typeof maybeResult.code === 'string' ? maybeResult.code : undefined,
    error:
      typeof maybeResult.error === 'string' ? maybeResult.error : undefined,
    flowId,
  };
}

function readStoredAuthResult(
  expectedFlowId?: string
): AuthCallbackResult | null {
  const raw = localStorage.getItem(CODE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AuthCallbackResult;
    if (expectedFlowId && parsed.flowId !== expectedFlowId) {
      return null;
    }
    if (parsed.code || parsed.brokerCode || parsed.error) {
      return parsed;
    }
  } catch {
    return expectedFlowId ? null : { code: raw };
  }

  return null;
}

export function appendOAuthFlowToRedirect(redirectUri: string, flowId: string) {
  const url = new URL(redirectUri);
  url.searchParams.set(LOOPBACK_FLOW_QUERY_PARAM, flowId);
  return url.toString();
}

function normalizeBrokerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function parseScopeString(scope: string | undefined): string[] | undefined {
  if (!scope) return undefined;
  const scopes = scope
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean);
  return scopes.length ? scopes : undefined;
}
