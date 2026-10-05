import fs from 'node:fs';
import path from 'node:path';

import { app, safeStorage } from 'electron';

import { logger } from '../logger';
import { publishGlobalStateUpdateFromMain } from '../shared-storage/broadcast';
import { globalStateStorage } from '../shared-storage/storage';
import {
  GOOGLE_SESSION_STORAGE_KEY,
  parseStoredGoogleSession,
  type StoredGoogleSession,
} from '../windows-manager/google-calendar-scheduler';

export const GOOGLE_SESSION_PUBLIC_STATE_KEY = 'nota-google-session-state:v1';

export type GoogleSessionPublicState = {
  connected: boolean;
  mutationId?: string;
  updatedAt: string;
};

let cachedSession: StoredGoogleSession | null | undefined;

function secureSessionPath() {
  return path.join(app.getPath('userData'), 'google-session.safe-storage');
}

function publicState(
  session: StoredGoogleSession | null,
  mutationId?: string
): GoogleSessionPublicState {
  return {
    connected: !!session,
    ...(mutationId ? { mutationId } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function publishPublicState(
  session: StoredGoogleSession | null,
  force = false,
  mutationId?: string
) {
  const current = globalStateStorage.get<GoogleSessionPublicState>(
    GOOGLE_SESSION_PUBLIC_STATE_KEY
  );
  if (!force && current?.connected === !!session) {
    return current;
  }
  const state = publicState(session, mutationId);
  globalStateStorage.set(GOOGLE_SESSION_PUBLIC_STATE_KEY, state);
  publishGlobalStateUpdateFromMain(GOOGLE_SESSION_PUBLIC_STATE_KEY, state);
  return state;
}

function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure operating-system storage is unavailable.');
  }
  if (
    process.platform === 'linux' &&
    safeStorage.getSelectedStorageBackend() === 'basic_text'
  ) {
    throw new Error(
      'A secure Linux password store is required for Google session persistence.'
    );
  }
}

function writeEncryptedSession(session: StoredGoogleSession) {
  requireEncryption();
  const filepath = secureSessionPath();
  fs.mkdirSync(path.dirname(filepath), { mode: 0o700, recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  const temporaryPath = `${filepath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, encrypted.toString('base64'), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(temporaryPath, 0o600);
  try {
    fs.renameSync(temporaryPath, filepath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }

    // Windows does not consistently replace an existing destination during
    // rename. Keep the atomic path on POSIX, with a narrow replacement
    // fallback for platforms that reject the overwrite.
    try {
      fs.rmSync(filepath, { force: true });
      fs.renameSync(temporaryPath, filepath);
    } catch (replacementError) {
      fs.rmSync(temporaryPath, { force: true });
      throw replacementError;
    }
  }
  fs.chmodSync(filepath, 0o600);
}

function readEncryptedSession() {
  const filepath = secureSessionPath();
  if (!fs.existsSync(filepath)) return null;
  requireEncryption();
  const encrypted = Buffer.from(fs.readFileSync(filepath, 'utf8'), 'base64');
  return parseStoredGoogleSession(
    JSON.parse(safeStorage.decryptString(encrypted))
  );
}

function migrateLegacySharedSession() {
  const legacy = parseStoredGoogleSession(
    globalStateStorage.get(GOOGLE_SESSION_STORAGE_KEY)
  );
  if (!legacy) return null;
  try {
    writeEncryptedSession(legacy);
  } finally {
    // Never retain the legacy plaintext token record if secure migration is
    // unavailable. The in-memory session remains usable for this launch and
    // the user can reconnect once an OS password store is available.
    globalStateStorage.del(GOOGLE_SESSION_STORAGE_KEY);
  }
  logger.info('Migrated Google session into operating-system secure storage.');
  return legacy;
}

export function readSecureGoogleSession() {
  if (cachedSession !== undefined) return cachedSession;
  try {
    cachedSession = readEncryptedSession() ?? migrateLegacySharedSession();
  } catch (error) {
    logger.error('Failed to read the secure Google session', error);
    cachedSession = null;
  }
  publishPublicState(cachedSession);
  return cachedSession;
}

export function saveSecureGoogleSession(value: unknown, mutationId?: string) {
  const session = parseStoredGoogleSession(value);
  if (!session) {
    throw new Error('Invalid Google session payload.');
  }
  writeEncryptedSession(session);
  cachedSession = session;
  globalStateStorage.del(GOOGLE_SESSION_STORAGE_KEY);
  return publishPublicState(session, true, mutationId);
}

export function clearSecureGoogleSession(mutationId?: string) {
  try {
    fs.rmSync(secureSessionPath(), { force: true });
  } catch (error) {
    logger.error('Failed to remove the secure Google session', error);
    throw new Error('Failed to remove the secure Google session.', {
      cause: error,
    });
  }
  cachedSession = null;
  globalStateStorage.del(GOOGLE_SESSION_STORAGE_KEY);
  return publishPublicState(null, true, mutationId);
}

export function resetSecureGoogleSessionCacheForTest() {
  cachedSession = undefined;
}
