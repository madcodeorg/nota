import os from 'node:os';
import path from 'node:path';

import { DocStoragePool } from '@nota/native';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';

const mocks = vi.hoisted(() => ({
  getSpaceDBPath: vi.fn(),
  getWorkspacesBasePath: vi.fn(),
}));
vi.mock('@nota/electron/helper/main-rpc', () => ({ mainRPC: {} }));
vi.mock('@nota/electron/helper/logger', () => ({
  logger: { log: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@nota/electron/helper/nbstore', () => ({
  getDocStoragePool: vi.fn(),
}));
vi.mock('@nota/electron/helper/workspace', () => ({
  storeWorkspaceMeta: vi.fn(),
}));
vi.mock('@nota/electron/helper/workspace/meta', () => ({
  getSpaceDBPath: mocks.getSpaceDBPath,
  getWorkspacesBasePath: mocks.getWorkspacesBasePath,
  getWorkspaceDBPath: vi.fn(),
}));

import {
  loadDBFile,
  setFakeDialogResult,
} from '@nota/electron/helper/dialog/dialog';

let directory: string;
let original: string;
let internal: string;
let pool: DocStoragePool;

describe('verified fresh-workspace restore', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    setFakeDialogResult(undefined);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nota-restore-test-'));
    original = path.join(directory, 'backup.nota');
    mocks.getWorkspacesBasePath.mockResolvedValue(
      path.join(directory, 'workspaces')
    );
    mocks.getSpaceDBPath.mockImplementation(async (_peer, _type, id) => {
      internal = path.join(directory, 'workspaces', 'local', id, 'storage.db');
      return internal;
    });
    pool = new DocStoragePool();
    await pool.connect('source', path.join(directory, 'source.db'));
    await pool.setSpaceId('source', 'original-workspace');
    const root = new Doc();
    root.getMap('meta').set('name', 'Original notes');
    await pool.setDocSnapshot('source', {
      docId: 'original-workspace',
      bin: encodeStateAsUpdate(root),
      timestamp: new Date(),
    });
    await pool.setBlob('source', {
      key: 'recording',
      data: new Uint8Array([1, 2, 3]),
      mime: 'audio/wav',
    });
    await pool.backup('source', original);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.disconnect('source');
    await pool.disconnect('restored');
    await fs.remove(directory);
  });

  it('publishes only after identity migration and validation, preserving the source and media', async () => {
    const previous = await fs.readFile(original);
    const result = await loadDBFile(original);
    expect(result.workspaceId).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(await fs.pathExists(`${internal}.importing`)).toBe(false);
    await pool.connect('restored', internal);
    const snapshot = await pool.getDocSnapshot('restored', result.workspaceId!);
    expect(snapshot).toBeTruthy();
    const restored = new Doc();
    applyUpdate(restored, snapshot!.bin);
    expect(restored.getMap('meta').get('name')).toBe('Original notes');
    expect(
      await pool.getDocSnapshot('restored', 'original-workspace')
    ).toBeNull();
    expect((await pool.getBlob('restored', 'recording'))?.data).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(await fs.readFile(original)).toEqual(previous);
  });

  it('rejects a corrupted copied file without leaving a discoverable or staged database', async () => {
    const previous = await fs.readFile(original);
    vi.spyOn(fs, 'copy').mockImplementationOnce(
      async (_source, destination) => {
        await fs.writeFile(String(destination), 'corrupted copied file');
      }
    );
    expect(await loadDBFile(original)).toEqual({ error: 'DB_FILE_INVALID' });
    expect(await fs.pathExists(internal)).toBe(false);
    expect(await fs.pathExists(`${internal}.importing`)).toBe(false);
    expect(await fs.readFile(original)).toEqual(previous);
  });
});
