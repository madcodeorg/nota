/* eslint-disable rxjs/finnish */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@nota/nbstore/google-drive', () => ({
  uploadDriveBackup: mocks.upload,
  GoogleDriveConnection: class {
    connect() {}
    disconnect() {}
    setTokenSnapshot() {}
    async waitForConnected() {}
  },
}));

import {
  copyLatestBackupToDrive,
  getDriveBackupState,
  setDriveBackupState,
} from './google-drive-maintenance';

const auth = {
  session: {
    userInfo$: { value: { sub: 'owner' } },
    getAccessToken: async () => 'token',
    getTokensSnapshot: () => ({ accessToken: 'token', expiresAt: 1e15 }),
  },
} as any;
const backups = [
  { name: 'backup-2026-10-04.nota', createdAt: 1, size: 3, verified: true },
  { name: 'backup-2026-10-05.nota', createdAt: 2, size: 4, verified: false },
];
const handlers = {
  listLocalBackups: vi.fn(async () => backups),
  readLocalBackup: vi.fn(async () => new Uint8Array([1, 2, 3])),
} as any;

describe('Google Drive backup copies', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({ size: '3' });
  });
  afterEach(() => localStorage.clear());

  test('does nothing until the user turns it on', async () => {
    await copyLatestBackupToDrive(handlers, auth, 'ws', 'uid');
    expect(handlers.listLocalBackups).not.toHaveBeenCalled();
  });

  test('copies the newest verified backup once and records the result', async () => {
    setDriveBackupState('ws', { enabled: true });
    const state = await copyLatestBackupToDrive(handlers, auth, 'ws', 'uid');
    expect(handlers.readLocalBackup).toHaveBeenCalledWith(
      'uid',
      'backup-2026-10-04.nota'
    );
    expect(mocks.upload.mock.calls[0].slice(1, 3)).toEqual([
      'ws',
      'backup-2026-10-04.nota',
    ]);
    expect(state).toMatchObject({
      lastCopiedName: 'backup-2026-10-04.nota',
      lastError: undefined,
    });
    await copyLatestBackupToDrive(handlers, auth, 'ws', 'uid');
    expect(mocks.upload).toHaveBeenCalledOnce();
  });

  test('records a failure without throwing so the local backup is unaffected', async () => {
    setDriveBackupState('ws', { enabled: true });
    mocks.upload.mockRejectedValue(new Error('Drive quota exceeded'));
    const state = await copyLatestBackupToDrive(handlers, auth, 'ws', 'uid');
    expect(state.lastError).toBe('Drive quota exceeded');
    expect(getDriveBackupState('ws').lastError).toBe('Drive quota exceeded');
  });
});
