import crypto from 'node:crypto';
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

// macOS: safeStorage uses the login keychain, which shows a "Nota Safe Storage"
// password prompt (again after updates or re-signing). Use a per-install random
// key in a 0600 file instead, so sign-in never prompts. Other platforms keep
// the OS store (DPAPI / libsecret), which does not prompt.
const FILE_KEY_PREFIX = 'k1:';

function fileKey() {
  const keyPath = path.join(app.getPath('userData'), 'google-session.key');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { mode: 0o700, recursive: true });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function sealSession(plain: string): string {
  if (process.platform !== 'darwin') {
    return safeStorage.encryptString(plain).toString('base64');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fileKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return (
    FILE_KEY_PREFIX +
    Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  );
}

function openSession(stored: string): string {
  if (process.platform !== 'darwin') {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  }
  // Old keychain-encrypted files cannot be read without the prompt; the user
  // reconnects Google once instead.
  if (!stored.startsWith(FILE_KEY_PREFIX)) {
    throw new Error('Google session uses the legacy keychain format.');
  }
  const raw = Buffer.from(stored.slice(FILE_KEY_PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    fileKey(),
    raw.subarray(0, 12)
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}

function requireEncryption() {
  if (process.platform === 'darwin') return;
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
  const encrypted = sealSession(JSON.stringify(session));
  const temporaryPath = `${filepath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, encrypted, {
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
  return parseStoredGoogleSession(
    JSON.parse(openSession(fs.readFileSync(filepath, 'utf8')))
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
