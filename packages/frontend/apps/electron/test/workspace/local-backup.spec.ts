import os from 'node:os';
import path from 'node:path';

import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalBackupPreferences } from '../../src/shared/type';

const mocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  showOpenDialog: vi.fn(),
  getSpaceDBPath: vi.fn(),
  getWorkspacesBasePath: vi.fn(),
  connect: vi.fn(),
  backup: vi.fn(),
  validate: vi.fn(),
  loadDBFile: vi.fn(),
}));

vi.mock('@nota/native', () => ({
  DocStorage: class {
    constructor(private readonly filename: string) {}
    async validate() {
      return mocks.validate(this.filename);
    }
  },
}));
vi.mock('@nota/nbstore', () => ({
  parseUniversalId: (value: string) => {
    const parts = /^@peer\((.*?)\);@type\((.*?)\);@id\((.*?)\);$/.exec(value);
    if (!parts) throw new Error('Invalid universal id');
    return { peer: parts[1], type: parts[2], id: parts[3] };
  },
}));
vi.mock('@nota/electron/helper/main-rpc', () => ({
  mainRPC: {
    getLocalBackupPreferences: mocks.getPreferences,
    setLocalBackupPreferences: mocks.setPreferences,
    showOpenDialog: mocks.showOpenDialog,
  },
}));
vi.mock('@nota/electron/helper/nbstore', () => ({
  getDocStoragePool: () => ({
    connect: mocks.connect,
    backup: mocks.backup,
  }),
}));
vi.mock('@nota/electron/helper/workspace/meta', () => ({
  getSpaceDBPath: mocks.getSpaceDBPath,
  getWorkspacesBasePath: mocks.getWorkspacesBasePath,
}));
vi.mock('@nota/electron/helper/dialog/dialog', () => ({
  loadDBFile: mocks.loadDBFile,
}));

import {
  getLocalBackupSettings,
  listLocalBackups,
  restoreLocalBackup,
  runLocalBackup,
  selectLocalBackupFolder,
  setLocalBackupEnabled,
} from '@nota/electron/helper/workspace/backup';

const id = '@peer(local);@type(workspace);@id(workspace);';
let directory: string;
let destination: string;
let managed: string;
let preferences: LocalBackupPreferences | undefined;

describe('local backup rotation and recovery', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'nota-backup-test-'))
    );
    destination = path.join(directory, 'chosen');
    managed = path.join(destination, 'Nota backups', 'workspace');
    await fs.ensureDir(destination);
    preferences = { enabled: true, destination };
    mocks.getPreferences.mockImplementation(async () => preferences);
    mocks.setPreferences.mockImplementation(async (_id, value) => {
      preferences = value;
    });
    mocks.getSpaceDBPath.mockResolvedValue(path.join(directory, 'source.db'));
    mocks.getWorkspacesBasePath.mockResolvedValue(
      path.join(directory, 'workspaces')
    );
    mocks.backup.mockImplementation(async (_id, filename) => {
      await fs.writeFile(filename, 'verified');
    });
    mocks.validate.mockImplementation(
      async filename => (await fs.readFile(filename, 'utf8')) === 'verified'
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-05T12:00:00Z'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(directory);
  });

  it('keeps seven daily snapshots and preserves unrelated files', async () => {
    await fs.ensureDir(managed);
    for (let day = 20; day <= 27; day++)
      await fs.writeFile(
        path.join(managed, `backup-2026-09-${day}.nota`),
        'verified'
      );
    await fs.writeFile(path.join(managed, 'my-export.nota'), 'personal export');
    const result = await runLocalBackup(id);
    expect(result.lastError).toBeUndefined();
    expect(result.lastSuccess).toBe(Date.now());
    expect(
      (await listLocalBackups(id)).filter(item => item.verified)
    ).toHaveLength(7);
    expect(
      await fs.readFile(path.join(managed, 'my-export.nota'), 'utf8')
    ).toBe('personal export');
    expect(
      await fs.pathExists(path.join(managed, 'backup-2026-09-20.nota'))
    ).toBe(false);
    expect(
      await fs.pathExists(path.join(managed, 'backup-2026-10-05.nota'))
    ).toBe(true);
  });

  it('runs at most once per 24 hours automatically and allows a manual backup', async () => {
    await runLocalBackup(id);
    await runLocalBackup(id);
    expect(mocks.backup).toHaveBeenCalledTimes(1);
    await runLocalBackup(id, true);
    expect(mocks.backup).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
    await runLocalBackup(id);
    expect(mocks.backup).toHaveBeenCalledTimes(3);
  });

  it('always retains the newly verified snapshot when older files have future timestamps', async () => {
    await fs.ensureDir(managed);
    for (let day = 20; day <= 27; day++)
      await fs.writeFile(
        path.join(managed, `backup-2027-09-${day}.nota`),
        'verified'
      );
    await runLocalBackup(id, true);
    const names = (await listLocalBackups(id)).map(item => item.name);
    expect(names).toHaveLength(7);
    expect(names).toContain('backup-2026-10-05.nota');
  });

  it('resumes automatic backups after a system clock correction', async () => {
    preferences = {
      ...preferences!,
      lastSuccess: Date.now() + 24 * 60 * 60 * 1000,
      lastAttempt: Date.now() + 24 * 60 * 60 * 1000,
    };
    await runLocalBackup(id);
    expect(mocks.backup).toHaveBeenCalledOnce();
    expect(preferences.lastSuccess).toBe(Date.now());
  });

  it('is opt-in and cannot enable backups before a folder is chosen', async () => {
    preferences = undefined;
    expect(await getLocalBackupSettings(id)).toEqual({ enabled: false });
    await runLocalBackup(id);
    expect(mocks.backup).not.toHaveBeenCalled();
    await expect(setLocalBackupEnabled(id, true)).rejects.toThrow(
      'Choose a backup folder'
    );
  });

  it('shares concurrent requests across windows', async () => {
    let release: (() => void) | undefined;
    const paused = new Promise<void>(resolve => {
      release = resolve;
    });
    mocks.backup.mockImplementation(async (_id, filename) => {
      await paused;
      await fs.writeFile(filename, 'verified');
    });
    const first = runLocalBackup(id, true);
    const second = runLocalBackup(id, true);
    expect(first).toBe(second);
    release?.();
    await first;
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

  it('does not prune or lose the prior successful status when a new backup fails', async () => {
    await fs.ensureDir(managed);
    for (let day = 20; day <= 27; day++)
      await fs.writeFile(
        path.join(managed, `backup-2026-09-${day}.nota`),
        'verified'
      );
    preferences = {
      ...preferences!,
      lastSuccess: Date.now() - 25 * 60 * 60 * 1000,
    };
    const lastSuccess = preferences.lastSuccess;
    mocks.backup.mockRejectedValue(new Error('Disk full'));
    const result = await runLocalBackup(id);
    expect(result.lastError).toBe('Disk full');
    expect(result.lastSuccess).toBe(lastSuccess);
    expect(await fs.readdir(managed)).toHaveLength(8);
    await runLocalBackup(id);
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

  it('uses only a picked folder and leaves preferences intact when cancelled', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect((await selectLocalBackupFolder(id)).canceled).toBe(true);
    expect(mocks.setPreferences).not.toHaveBeenCalled();
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [destination],
    });
    expect((await selectLocalBackupFolder(id)).settings.destination).toBe(
      await fs.realpath(destination)
    );
  });

  it('rejects non-local identities and directory traversal', async () => {
    for (const invalid of [
      id.replace('local', 'google-drive'),
      id.replace('workspace);', '../outside);'),
    ]) {
      await expect(getLocalBackupSettings(invalid)).rejects.toThrow(
        'local workspaces'
      );
    }
    await expect(restoreLocalBackup(id, '../outside.nota')).rejects.toThrow(
      'Invalid backup'
    );
    expect(mocks.loadDBFile).not.toHaveBeenCalled();
  });

  it('verifies a selected snapshot and restores it through the fresh-workspace importer', async () => {
    await runLocalBackup(id, true);
    mocks.loadDBFile.mockResolvedValue({ workspaceId: 'restored-workspace' });
    expect(await restoreLocalBackup(id, 'backup-2026-10-05.nota')).toEqual({
      workspaceId: 'restored-workspace',
    });
    expect(mocks.loadDBFile).toHaveBeenCalledWith(
      path.join(managed, 'backup-2026-10-05.nota')
    );
    await fs.writeFile(
      path.join(managed, 'backup-2026-10-05.nota'),
      'corrupted'
    );
    expect((await listLocalBackups(id))[0].verified).toBe(false);
    await expect(
      restoreLocalBackup(id, 'backup-2026-10-05.nota')
    ).rejects.toThrow('failed verification');
    expect(mocks.loadDBFile).toHaveBeenCalledTimes(1);
  });

  it('rejects redirected backup directories and snapshot symlinks', async () => {
    if (process.platform === 'win32') return;
    const outside = path.join(directory, 'outside');
    await fs.ensureDir(outside);
    await fs.ensureDir(path.join(destination, 'Nota backups'));
    await fs.symlink(outside, managed);
    expect((await runLocalBackup(id, true)).lastError).toContain('redirected');
    expect(mocks.backup).not.toHaveBeenCalled();
    await fs.unlink(managed);
    await fs.ensureDir(managed);
    await fs.writeFile(path.join(outside, 'external.nota'), 'verified');
    await fs.symlink(
      path.join(outside, 'external.nota'),
      path.join(managed, 'backup-2026-10-05.nota')
    );
    await expect(
      restoreLocalBackup(id, 'backup-2026-10-05.nota')
    ).rejects.toThrow('failed verification');
    expect(await listLocalBackups(id)).toHaveLength(0);
  });
});
