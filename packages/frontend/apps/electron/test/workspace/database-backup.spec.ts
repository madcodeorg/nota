import {
  saveDBFileAs,
  setFakeDialogResult,
} from '@nota/electron/helper/dialog/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  backup: vi.fn(),
  checkpoint: vi.fn(),
  copyFile: vi.fn(),
  getSpaceDBPath: vi.fn(),
  getWorkspacesBasePath: vi.fn(),
  realpath: vi.fn(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn(),
}));

vi.mock('@nota/native', () => ({ DocStorage: vi.fn(), ValidationResult: {} }));
vi.mock('@nota/nbstore', () => ({
  parseUniversalId: () => ({
    peer: 'local',
    type: 'workspace',
    id: 'workspace',
  }),
}));
vi.mock('fs-extra', () => ({
  default: { copyFile: mocks.copyFile, realpath: mocks.realpath },
}));
vi.mock('@nota/electron/helper/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn() },
}));
vi.mock('@nota/electron/helper/main-rpc', () => ({
  mainRPC: {
    showSaveDialog: mocks.showSaveDialog,
    showItemInFolder: mocks.showItemInFolder,
  },
}));
vi.mock('@nota/electron/helper/nbstore', () => ({
  getDocStoragePool: () => ({
    connect: mocks.connect,
    backup: mocks.backup,
    checkpoint: mocks.checkpoint,
  }),
}));
vi.mock('@nota/electron/helper/workspace', () => ({
  storeWorkspaceMeta: vi.fn(),
}));
vi.mock('@nota/electron/helper/workspace/meta', () => ({
  getSpaceDBPath: mocks.getSpaceDBPath,
  getWorkspaceDBPath: vi.fn(),
  getWorkspacesBasePath: mocks.getWorkspacesBasePath,
}));

describe('consistent workspace export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setFakeDialogResult(undefined);
    mocks.getSpaceDBPath.mockResolvedValue('/workspace/storage.db');
    mocks.getWorkspacesBasePath.mockResolvedValue('/app/workspaces');
    mocks.realpath.mockImplementation(async filename => filename);
    mocks.showItemInFolder.mockResolvedValue(undefined);
  });

  it('uses the verified native snapshot, including committed WAL data', async () => {
    mocks.showSaveDialog.mockResolvedValue({
      filePath: '/backups/workspace.nota',
    });
    expect(await saveDBFileAs('local:workspace:workspace', 'My notes')).toEqual(
      {
        filePath: '/backups/workspace.nota',
      }
    );
    expect(mocks.connect).toHaveBeenCalledWith(
      'local:workspace:workspace',
      '/workspace/storage.db'
    );
    expect(mocks.backup).toHaveBeenCalledWith(
      'local:workspace:workspace',
      '/backups/workspace.nota'
    );
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(
      '/backups/workspace.nota'
    );
  });

  it('cancels before touching the database or destination', async () => {
    setFakeDialogResult({ canceled: true });
    expect(await saveDBFileAs('local:workspace:workspace', 'My notes')).toEqual(
      {
        canceled: true,
      }
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it('rejects an invalid workspace source before invoking native storage', async () => {
    mocks.getSpaceDBPath.mockResolvedValue('');
    expect(await saveDBFileAs('local:workspace:workspace', 'My notes')).toEqual(
      {
        error: 'DB_FILE_PATH_INVALID',
      }
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('reports failed verification without revealing or falling back to copying', async () => {
    setFakeDialogResult({ filePath: '/backups/workspace.nota' });
    mocks.backup.mockRejectedValue(new Error('Backup failed validation'));
    expect(await saveDBFileAs('local:workspace:workspace', 'My notes')).toEqual(
      {
        error: 'UNKNOWN_ERROR',
      }
    );
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('refuses export destinations in another active workspace, including redirected parents', async () => {
    setFakeDialogResult({ filePath: '/app/workspaces/local/other/storage.db' });
    expect(await saveDBFileAs('local:workspace:workspace', 'My notes')).toEqual(
      { error: 'DB_FILE_PATH_INVALID' }
    );
    expect(mocks.backup).not.toHaveBeenCalled();
    setFakeDialogResult({ filePath: '/redirected/storage.db' });
    mocks.realpath.mockImplementation(async filename =>
      filename === '/redirected' ? '/app/workspaces/local/other' : filename
    );
    expect(await saveDBFileAs('local:workspace:workspace', 'My notes')).toEqual(
      { error: 'DB_FILE_PATH_INVALID' }
    );
    expect(mocks.backup).not.toHaveBeenCalled();
  });
});
