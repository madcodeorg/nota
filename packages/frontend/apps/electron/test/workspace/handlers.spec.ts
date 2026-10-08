import path from 'node:path';

import { universalId } from '@nota/nbstore';
import fs from 'fs-extra';
import { v4 } from 'uuid';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

const tmpDir = path.join(__dirname, 'tmp');
const appDataPath = path.join(tmpDir, 'app-data');

vi.doMock('@nota/electron/helper/db/ensure-db', () => ({
  ensureSQLiteDB: async () => ({
    destroy: () => {},
  }),
}));

vi.doMock('@nota/electron/helper/main-rpc', () => ({
  mainRPC: {
    getPath: async () => appDataPath,
  },
}));

afterEach(async () => {
  try {
    await fs.remove(tmpDir);
  } catch (e) {
    console.error(e);
  }
});

afterAll(() => {
  vi.doUnmock('@nota/electron/helper/main-rpc');
});

describe('workspace db management', () => {
  test('lists no archived workspaces in a fresh profile', async () => {
    const { getDeletedWorkspaces } =
      await import('@nota/electron/helper/workspace/handlers');
    expect(await getDeletedWorkspaces()).toEqual({ items: [] });
    expect(
      await fs.pathExists(path.join(appDataPath, 'deleted-workspaces'))
    ).toBe(false);
  });

  test('reports archive storage errors instead of hiding them as an empty list', async () => {
    const { getDeletedWorkspaces } =
      await import('@nota/electron/helper/workspace/handlers');
    await fs.outputFile(
      path.join(appDataPath, 'deleted-workspaces'),
      'not a directory'
    );
    await expect(getDeletedWorkspaces()).rejects.toHaveProperty(
      'code',
      'ENOTDIR'
    );
  });

  test('list local workspace ids', async () => {
    const { listLocalWorkspaceIds } =
      await import('@nota/electron/helper/workspace/handlers');
    const validWorkspaceId = v4();
    const noDbWorkspaceId = v4();
    const deletedWorkspaceId = v4();
    const fileEntry = 'README.txt';

    const validWorkspacePath = path.join(
      appDataPath,
      'workspaces',
      'local',
      validWorkspaceId
    );
    const noDbWorkspacePath = path.join(
      appDataPath,
      'workspaces',
      'local',
      noDbWorkspaceId
    );
    const deletedWorkspacePath = path.join(
      appDataPath,
      'workspaces',
      'local',
      deletedWorkspaceId
    );
    const deletedWorkspaceTrashPath = path.join(
      appDataPath,
      'deleted-workspaces',
      deletedWorkspaceId
    );
    const nonDirectoryPath = path.join(
      appDataPath,
      'workspaces',
      'local',
      fileEntry
    );

    await fs.ensureDir(validWorkspacePath);
    await fs.ensureFile(path.join(validWorkspacePath, 'storage.db'));
    await fs.ensureDir(noDbWorkspacePath);
    await fs.ensureDir(deletedWorkspacePath);
    await fs.ensureFile(path.join(deletedWorkspacePath, 'storage.db'));
    await fs.ensureDir(deletedWorkspaceTrashPath);
    await fs.outputFile(nonDirectoryPath, 'not-a-workspace');

    const ids = await listLocalWorkspaceIds();
    expect(ids).toContain(validWorkspaceId);
    expect(ids).not.toContain(noDbWorkspaceId);
    expect(ids).not.toContain(deletedWorkspaceId);
    expect(ids).not.toContain(fileEntry);
  });

  test('trash workspace', async () => {
    const { trashWorkspace } =
      await import('@nota/electron/helper/workspace/handlers');
    const workspaceId = v4();
    const workspacePath = path.join(
      appDataPath,
      'workspaces',
      'local',
      workspaceId
    );
    await fs.ensureDir(workspacePath);
    await trashWorkspace(
      universalId({ peer: 'local', type: 'workspace', id: workspaceId })
    );
    expect(await fs.pathExists(workspacePath)).toBe(false);
    // removed workspace will be moved to deleted-workspaces
    expect(
      await fs.pathExists(
        path.join(appDataPath, 'deleted-workspaces', workspaceId)
      )
    ).toBe(true);
  });

  test('delete workspace', async () => {
    const { deleteWorkspace } =
      await import('@nota/electron/helper/workspace/handlers');
    const workspaceId = v4();
    const workspacePath = path.join(
      appDataPath,
      'workspaces',
      'local',
      workspaceId
    );
    await fs.ensureDir(workspacePath);
    await deleteWorkspace(
      universalId({ peer: 'local', type: 'workspace', id: workspaceId })
    );
    expect(await fs.pathExists(workspacePath)).toBe(false);
    // deleted workspace will remove it permanently
    expect(
      await fs.pathExists(
        path.join(appDataPath, 'deleted-workspaces', workspaceId)
      )
    ).toBe(false);
  });
});
