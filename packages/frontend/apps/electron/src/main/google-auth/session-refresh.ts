import {
  isGoogleSessionRevokedError,
  resolveGoogleCalendarSession,
  type StoredGoogleSession,
} from '../windows-manager/google-calendar-scheduler';
import {
  clearSecureGoogleSession,
  readSecureGoogleSession,
  saveSecureGoogleSession,
} from './secure-session';

const GOOGLE_SESSION_REFRESH_TIMEOUT_MS = 8_000;

let refreshPromise: Promise<StoredGoogleSession | null> | null = null;
let refreshMutationId: string | undefined;

async function refreshCurrentSession(): Promise<StoredGoogleSession | null> {
  const source = readSecureGoogleSession();
  if (!source) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GOOGLE_SESSION_REFRESH_TIMEOUT_MS
  );
  try {
    const refreshed = await resolveGoogleCalendarSession({
      brokerUrl: BUILD_CONFIG.googleAuthBrokerUrl,
      clientId: BUILD_CONFIG.googleClientId,
      session: source,
      signal: controller.signal,
    });

    // A disconnect or reconnect may have completed while refresh was in
    // flight. Never let the old result restore or replace that session.
    const current = readSecureGoogleSession();
    if (current !== source) return current;

    if (refreshed !== source) {
      saveSecureGoogleSession(refreshed, refreshMutationId);
    }
    return refreshed;
  } catch (error) {
    if (
      isGoogleSessionRevokedError(error) &&
      readSecureGoogleSession() === source
    ) {
      clearSecureGoogleSession();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Main-process authority for access-token refresh. Renderer and background
 * calendar callers share this promise so a rotating refresh token is consumed
 * and persisted exactly once.
 */
export function resolveSecureGoogleSession(mutationId?: string) {
  // A scheduler refresh may already be in flight when the renderer joins it.
  // Correlate the eventual connected-state broadcast with that renderer so it
  // does not invalidate its own refresh response before IPC returns.
  refreshMutationId ??= mutationId;
  if (!refreshPromise) {
    const refresh = refreshCurrentSession().finally(() => {
      if (refreshPromise === refresh) {
        refreshPromise = null;
        refreshMutationId = undefined;
      }
    });
    refreshPromise = refresh;
  }
  return refreshPromise;
}

export function resetGoogleSessionRefreshForTest() {
  refreshPromise = null;
  refreshMutationId = undefined;
}
