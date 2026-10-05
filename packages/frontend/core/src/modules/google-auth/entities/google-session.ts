import { Entity, LiveData } from '@nota/infra';

const STORAGE_KEY = 'nota-google-tokens';
const PUBLIC_SESSION_STATE_KEY = 'nota-google-session-state:v1';
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix timestamp ms
  refreshMode?: 'google' | 'broker';
  authBrokerUrl?: string;
  scopes?: string[];
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture?: string;
  sub: string;
}

type StoredGoogleSession = {
  tokens: GoogleTokens;
  userInfo: GoogleUserInfo;
};

type GoogleSessionStorage = {
  ready?: Promise<void>;
  get<T>(key: string): T | undefined;
  watch?<T>(key: string, cb: (value: T | undefined) => void): () => void;
};

type SecureGoogleSessionApi = {
  clearSession(mutationId?: string): Promise<unknown>;
  getSession(): Promise<unknown>;
  refreshSession?(mutationId?: string): Promise<unknown>;
  setSession(
    session: StoredGoogleSession,
    mutationId?: string
  ): Promise<unknown>;
};

type PublicGoogleSessionState = {
  connected?: boolean;
  mutationId?: string;
};

export type GoogleSessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

class GoogleSessionRevokedError extends Error {
  override readonly name = 'GoogleSessionRevokedError';
}

async function googleRefreshError(response: Response, prefix: string) {
  const text = await response.text().catch(() => '');
  type GoogleRefreshErrorBody = {
    error?: string | { message?: string };
    error_description?: string;
  };
  let body: GoogleRefreshErrorBody | null = null;
  try {
    body = text ? (JSON.parse(text) as GoogleRefreshErrorBody) : null;
  } catch {
    // Keep the raw response text as the most useful retry guidance.
  }

  const code = typeof body?.error === 'string' ? body.error : null;
  const objectMessage =
    body?.error && typeof body.error === 'object'
      ? body.error.message
      : undefined;
  const details =
    body?.error_description ?? code ?? objectMessage ?? text.trim();
  const message = `${prefix}: ${response.status}${details ? ` ${details}` : ''}`;
  const normalized = `${code ?? ''} ${details}`.toLowerCase();
  if (
    response.status === 401 ||
    code === 'invalid_grant' ||
    code === 'invalid_token' ||
    /invalid (?:broker|refresh) token|refresh token (?:expired|revoked)/.test(
      normalized
    )
  ) {
    return new GoogleSessionRevokedError(message);
  }
  return new Error(message);
}

export class GoogleSession extends Entity {
  readonly status$: LiveData<GoogleSessionStatus> =
    new LiveData<GoogleSessionStatus>('disconnected');
  readonly userInfo$: LiveData<GoogleUserInfo | null> =
    new LiveData<GoogleUserInfo | null>(null);

  private tokens: GoogleTokens | null = null;
  private unwatchSharedStorage: (() => void) | null = null;
  private secureLoadGeneration = 0;
  private refreshPromise: Promise<string | null> | null = null;
  private secureMutationCounter = 0;
  private readonly localSecureMutationIds = new Set<string>();

  constructor() {
    super();
    const secureApi = this.getSecureSessionApi();
    if (secureApi) {
      const legacy = this.readLocalStorage();
      if (legacy) {
        this.applyStoredSession(legacy);
      }
      this.loadFromSecureStorage(legacy).catch(error => {
        console.error('[GoogleSession] Secure session load failed:', error);
      });
      this.setupSharedStorageSync();
    } else {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    const stored = this.readLocalStorage();
    if (stored) {
      this.applyStoredSession(stored);
    }
  }

  private readLocalStorage(): StoredGoogleSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      return this.parseStoredSession(JSON.parse(raw));
    } catch {
      // Ignore parse errors — treat as disconnected
      return null;
    }
  }

  private async saveToStorage(
    tokens: GoogleTokens,
    userInfo: GoogleUserInfo
  ): Promise<void> {
    const stored = { tokens, userInfo };
    const secureApi = this.getSecureSessionApi();
    if (secureApi) {
      const result = await this.persistSecureSession(stored);
      if (!result?.connected) {
        throw new Error('Google session was not persisted securely.');
      }
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  private setupSharedStorageSync(): void {
    const storage = this.getSharedStorage();
    if (!storage || !this.getSecureSessionApi()) return;

    const watchSharedStorage = () => {
      this.unwatchSharedStorage?.();
      this.unwatchSharedStorage =
        storage.watch?.<PublicGoogleSessionState>(
          PUBLIC_SESSION_STATE_KEY,
          state => {
            if (
              state?.mutationId &&
              this.localSecureMutationIds.delete(state.mutationId)
            ) {
              return;
            }
            if (state?.connected) {
              this.loadFromSecureStorage().catch(error => {
                console.error(
                  '[GoogleSession] Secure session reload failed:',
                  error
                );
              });
              return;
            }

            this.secureLoadGeneration += 1;
            this.tokens = null;
            localStorage.removeItem(STORAGE_KEY);
            this.userInfo$.next(null);
            this.status$.next('disconnected');
          }
        ) ?? null;
    };

    void (storage.ready ?? Promise.resolve())
      .then(() => {
        watchSharedStorage();
      })
      .catch(() => {
        // localStorage fallback remains available.
      });
  }

  private getSharedStorage(): GoogleSessionStorage | null {
    if (!BUILD_CONFIG.isElectron) return null;

    return (
      (
        globalThis as {
          __sharedStorage?: { globalState?: GoogleSessionStorage };
        }
      ).__sharedStorage?.globalState ?? null
    );
  }

  private getSecureSessionApi(): SecureGoogleSessionApi | null {
    if (!BUILD_CONFIG.isElectron) return null;
    return (
      (
        globalThis as {
          __apis?: { googleAuth?: SecureGoogleSessionApi };
        }
      ).__apis?.googleAuth ?? null
    );
  }

  private createSecureMutationId(): string {
    const mutationId = `${Date.now().toString(36)}-${(++this
      .secureMutationCounter).toString(
      36
    )}-${Math.random().toString(36).slice(2)}`;
    this.localSecureMutationIds.add(mutationId);
    while (this.localSecureMutationIds.size > 16) {
      const oldest = this.localSecureMutationIds.values().next().value;
      if (typeof oldest !== 'string') break;
      this.localSecureMutationIds.delete(oldest);
    }
    return mutationId;
  }

  private async persistSecureSession(stored: StoredGoogleSession) {
    const secureApi = this.getSecureSessionApi();
    if (!secureApi) return null;
    const mutationId = this.createSecureMutationId();
    try {
      return (await secureApi.setSession(
        stored,
        mutationId
      )) as PublicGoogleSessionState | null;
    } catch (error) {
      this.localSecureMutationIds.delete(mutationId);
      throw error;
    }
  }

  private async loadFromSecureStorage(legacy?: StoredGoogleSession | null) {
    const secureApi = this.getSecureSessionApi();
    if (!secureApi) return;
    const generation = ++this.secureLoadGeneration;
    try {
      let stored = this.parseStoredSession(await secureApi.getSession());
      if (!stored && legacy) {
        const result = await this.persistSecureSession(legacy);
        if (result?.connected) {
          stored = legacy;
        }
      }
      if (generation !== this.secureLoadGeneration) return;
      if (stored) {
        this.applyStoredSession(stored);
        localStorage.removeItem(STORAGE_KEY);
      } else if (!legacy) {
        this.tokens = null;
        this.userInfo$.next(null);
        this.status$.next('disconnected');
      }
    } catch (error) {
      console.error('[GoogleSession] Secure session load failed:', error);
      if (!legacy) {
        this.status$.next('error');
      }
    } finally {
      if (legacy) {
        // Do not retain OAuth credentials in renderer localStorage if the OS
        // password store is unavailable. The current in-memory session still
        // works, but reconnecting will be required after restart.
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  private parseStoredSession(value: unknown): StoredGoogleSession | null {
    if (!value || typeof value !== 'object') return null;

    const parsed = value as Partial<StoredGoogleSession>;
    if (!parsed.tokens || !parsed.userInfo) return null;

    return {
      tokens: parsed.tokens,
      userInfo: parsed.userInfo,
    };
  }

  private applyStoredSession(stored: StoredGoogleSession): void {
    this.tokens = stored.tokens;
    this.userInfo$.next(stored.userInfo);
    this.status$.next('connected');
  }

  async setTokens(
    tokens: GoogleTokens,
    userInfo: GoogleUserInfo
  ): Promise<void> {
    const generation = ++this.secureLoadGeneration;
    await this.saveToStorage(tokens, userInfo);
    if (generation !== this.secureLoadGeneration) {
      throw new DOMException(
        'Google session changed while credentials were being persisted.',
        'AbortError'
      );
    }
    this.tokens = tokens;
    this.userInfo$.next(userInfo);
    this.status$.next('connected');
  }

  getTokensSnapshot(): GoogleTokens | null {
    return this.tokens ? { ...this.tokens } : null;
  }

  async clear(): Promise<void> {
    const generation = ++this.secureLoadGeneration;
    const previousStatus = this.status$.value;
    const secureApi = this.getSecureSessionApi();
    if (secureApi) {
      const mutationId = this.createSecureMutationId();
      try {
        const result = (await secureApi.clearSession(
          mutationId
        )) as PublicGoogleSessionState | null;
        if (result?.connected !== false) {
          throw new Error('Google session was not cleared securely.');
        }
      } catch (error) {
        this.localSecureMutationIds.delete(mutationId);
        console.error('[GoogleSession] Secure session clear failed:', error);
        if (generation === this.secureLoadGeneration) {
          this.status$.next(previousStatus);
        }
        throw error;
      }
    }
    if (generation !== this.secureLoadGeneration) {
      return;
    }
    this.tokens = null;
    localStorage.removeItem(STORAGE_KEY);
    this.userInfo$.next(null);
    this.status$.next('disconnected');
  }

  setConnecting(): void {
    this.status$.next('connecting');
  }

  private isExpiredSoon(): boolean {
    if (!this.tokens) return true;
    return Date.now() >= this.tokens.expiresAt - REFRESH_BEFORE_EXPIRY_MS;
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;

    if (!this.isExpiredSoon()) {
      return this.tokens.accessToken;
    }

    // Calendar and account refreshes can run concurrently. Share one refresh
    // so a broker-rotated refresh token cannot be consumed twice.
    if (!this.refreshPromise) {
      const refresh = this.refreshAccessToken().finally(() => {
        if (this.refreshPromise === refresh) {
          this.refreshPromise = null;
        }
      });
      this.refreshPromise = refresh;
    }
    return this.refreshPromise;
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (!this.tokens?.refreshToken) return null;

    const sourceTokens = this.tokens;
    const generation = this.secureLoadGeneration;

    try {
      const secureApi = this.getSecureSessionApi();
      if (secureApi?.refreshSession) {
        const mutationId = this.createSecureMutationId();
        let stored: StoredGoogleSession | null;
        try {
          stored = this.parseStoredSession(
            await secureApi.refreshSession(mutationId)
          );
        } catch (error) {
          this.localSecureMutationIds.delete(mutationId);
          throw error;
        }
        const sourceStillCurrent =
          this.tokens?.refreshToken === sourceTokens.refreshToken;
        if (generation !== this.secureLoadGeneration || !sourceStillCurrent) {
          // Another trusted renderer can join the same main-process refresh,
          // so its mutation id may be the one broadcast. If this session was
          // not actually cleared or replaced, the authenticated IPC response
          // remains authoritative even while the broadcast reload is pending.
          if (stored && sourceStillCurrent) {
            this.applyStoredSession(stored);
            return stored.tokens.accessToken;
          }
          return this.tokens?.accessToken ?? null;
        }
        if (!stored) {
          this.status$.next('error');
          return null;
        }
        this.applyStoredSession(stored);
        return stored.tokens.accessToken;
      }

      // Browser/web builds retain their existing direct refresh path when the
      // authenticated Electron API is unavailable.
      const updatedTokens =
        sourceTokens.refreshMode === 'broker'
          ? await this.refreshBrokerAccessToken(sourceTokens)
          : await this.refreshGoogleAccessToken(sourceTokens);

      // Disconnect or reconnect may have happened while the request was in
      // flight. Never let an old refresh restore or overwrite that session.
      if (
        generation !== this.secureLoadGeneration ||
        this.tokens?.refreshToken !== sourceTokens.refreshToken
      ) {
        return this.tokens?.accessToken ?? null;
      }

      const userInfo = this.userInfo$.value;
      if (userInfo) {
        await this.setTokens(updatedTokens, userInfo);
      } else {
        this.tokens = updatedTokens;
      }

      return updatedTokens.accessToken;
    } catch (err) {
      console.error('[GoogleSession] Token refresh failed:', err);
      if (generation === this.secureLoadGeneration) {
        if (err instanceof GoogleSessionRevokedError) {
          // A rejected refresh token cannot recover by retrying. Remove it
          // from secure storage so restart does not falsely reconnect it.
          await this.clear().catch(clearError => {
            console.error(
              '[GoogleSession] Failed to clear revoked session:',
              clearError
            );
          });
        } else {
          this.status$.next('error');
        }
      }
      return null;
    }
  }

  private async refreshGoogleAccessToken(
    tokens: GoogleTokens
  ): Promise<GoogleTokens> {
    const params = new URLSearchParams({
      client_id: BUILD_CONFIG.googleClientId,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw await googleRefreshError(response, 'Token refresh failed');
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    const updatedTokens: GoogleTokens = {
      accessToken: data.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshMode: 'google',
      scopes: tokens.scopes,
    };

    return updatedTokens;
  }

  private async refreshBrokerAccessToken(
    tokens: GoogleTokens
  ): Promise<GoogleTokens> {
    const brokerUrl = normalizeBrokerUrl(
      tokens.authBrokerUrl || BUILD_CONFIG.googleAuthBrokerUrl
    );

    if (!brokerUrl) {
      throw new Error('Google auth broker URL is missing');
    }

    const response = await fetch(`${brokerUrl}/api/google/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (!response.ok) {
      throw await googleRefreshError(response, 'Broker token refresh failed');
    }

    const data = (await response.json()) as {
      accessToken: string;
      expiresIn: number;
      refreshToken?: string;
    };

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
      refreshMode: 'broker',
      authBrokerUrl: brokerUrl,
      scopes: tokens.scopes,
    };
  }
}

function normalizeBrokerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
