import {
  GoogleDriveConnection,
  uploadDriveBackup,
} from '@nota/nbstore/google-drive';

import type { DesktopApiService } from '../../desktop-api';
import type { GoogleAuthService } from '../../google-auth';

type WorkspaceHandlers = DesktopApiService['handler']['workspace'];

/** Run one task with a short-lived Drive connection for the signed-in account. */
export async function withGoogleDrive<T>(
  auth: GoogleAuthService,
  task: (connection: GoogleDriveConnection) => Promise<T>,
  expectedAccountId?: string
): Promise<T> {
  const session = auth.session;
  const accountId = session.userInfo$.value?.sub;
  if (!accountId) throw new Error('Connect Google Drive first.');
  if (expectedAccountId && accountId !== expectedAccountId)
    throw new Error(
      'Reconnect the Google account that owns this workspace to continue.'
    );
  await session.getAccessToken();
  const tokens = session.getTokensSnapshot();
  if (!tokens || session.userInfo$.value?.sub !== accountId)
    throw new Error('Google account changed. Try again.');
  const connection = new GoogleDriveConnection({
    accountId,
    tokens: {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      accountId,
    },
  });
  connection.connect();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    await connection.waitForConnected(controller.signal);
    return await task(connection);
  } finally {
    clearTimeout(timer);
    connection.setTokenSnapshot(null);
    connection.disconnect(true);
  }
}

const DRIVE_BACKUP_KEY = 'nota-google-drive-backup-copies';

export interface DriveBackupState {
  enabled?: boolean;
  lastCopy?: number;
  lastCopiedName?: string;
  lastCopiedSize?: number;
  lastError?: string;
}

function readDriveBackupStates(): Record<string, DriveBackupState> {
  try {
    return JSON.parse(localStorage.getItem(DRIVE_BACKUP_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function getDriveBackupState(workspaceId: string): DriveBackupState {
  return readDriveBackupStates()[workspaceId] ?? {};
}

export function setDriveBackupState(
  workspaceId: string,
  patch: DriveBackupState
): DriveBackupState {
  const states = readDriveBackupStates();
  const next = { ...states[workspaceId], ...patch };
  localStorage.setItem(
    DRIVE_BACKUP_KEY,
    JSON.stringify({ ...states, [workspaceId]: next })
  );
  return next;
}

/**
 * Copy the newest verified local backup to Drive when the user turned it on.
 * The local backup stays the primary copy; failures are recorded, not thrown.
 */
export async function copyLatestBackupToDrive(
  handlers: WorkspaceHandlers,
  auth: GoogleAuthService,
  workspaceId: string,
  universalId: string,
  force = false
): Promise<DriveBackupState> {
  const state = getDriveBackupState(workspaceId);
  if (!state.enabled || !auth.session.userInfo$.value) return state;
  try {
    const latest = (await handlers.listLocalBackups(universalId))
      .filter(backup => backup.verified)
      .sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!latest) return state;
    if (
      !force &&
      state.lastCopiedName === latest.name &&
      state.lastCopiedSize === latest.size &&
      (state.lastCopy ?? 0) >= latest.createdAt
    )
      return state;
    const content = await handlers.readLocalBackup(universalId, latest.name);
    await withGoogleDrive(auth, connection =>
      uploadDriveBackup(connection, workspaceId, latest.name, content)
    );
    return setDriveBackupState(workspaceId, {
      lastCopy: Date.now(),
      lastCopiedName: latest.name,
      lastCopiedSize: latest.size,
      lastError: undefined,
    });
  } catch (error) {
    return setDriveBackupState(workspaceId, {
      lastError:
        error instanceof Error
          ? error.message
          : 'The Google Drive backup copy failed.',
    });
  }
}
