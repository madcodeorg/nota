import path from 'node:path';

import { DocStorage } from '@nota/native';
import { parseUniversalId } from '@nota/nbstore';
import fs from 'fs-extra';

import type { LocalBackupPreferences } from '../../shared/type';
import { loadDBFile } from '../dialog/dialog';
import { mainRPC } from '../main-rpc';
import { getDocStoragePool } from '../nbstore';
import { getSpaceDBPath, getWorkspacesBasePath } from './meta';

const DAY = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL = 10 * 60 * 1000;
const RETAINED_BACKUPS = 7;
const BACKUP_FILENAME = /^backup-\d{4}-\d{2}-\d{2}\.nota$/;
const inFlight = new Map<string, Promise<LocalBackupPreferences>>();

function localWorkspaceId(universalId: string) {
  const { peer, type, id } = parseUniversalId(universalId);
  if (peer !== 'local' || type !== 'workspace' || !/^[\w-]{1,128}$/.test(id)) {
    throw new Error('Local backups are available for local workspaces only.');
  }
  return id;
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

export async function getLocalBackupSettings(
  universalId: string
): Promise<LocalBackupPreferences> {
  const id = localWorkspaceId(universalId);
  return (await mainRPC.getLocalBackupPreferences(id)) ?? { enabled: false };
}

async function saveSettings(id: string, settings: LocalBackupPreferences) {
  await mainRPC.setLocalBackupPreferences(id, settings);
  return settings;
}

export async function setLocalBackupEnabled(
  universalId: string,
  enabled: boolean
) {
  const id = localWorkspaceId(universalId);
  const settings = await getLocalBackupSettings(universalId);
  if (typeof enabled !== 'boolean')
    throw new Error('Invalid backup preference.');
  if (enabled && !settings.destination)
    throw new Error('Choose a backup folder first.');
  return saveSettings(id, { ...settings, enabled });
}

export async function selectLocalBackupFolder(universalId: string) {
  const id = localWorkspaceId(universalId);
  if (inFlight.has(id))
    throw new Error('Wait for the current backup to finish.');
  const result = await mainRPC.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose local backup folder',
    buttonLabel: 'Use this folder',
    message:
      'Nota will keep up to seven daily workspace backups in this folder.',
  });
  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true,
      settings: await getLocalBackupSettings(universalId),
    };
  }
  if (inFlight.has(id))
    throw new Error('Wait for the current backup to finish.');
  const destination = await fs.realpath(result.filePaths[0]);
  if (isInside(path.resolve(await getWorkspacesBasePath()), destination)) {
    throw new Error('Choose a folder outside the active workspace storage.');
  }
  const settings = await getLocalBackupSettings(universalId);
  return {
    canceled: false,
    settings: await saveSettings(id, {
      enabled: settings.enabled,
      destination,
    }),
  };
}

async function backupDirectory(
  id: string,
  settings: LocalBackupPreferences,
  create = false
) {
  if (!settings.destination || !path.isAbsolute(settings.destination)) {
    throw new Error('Choose a backup folder first.');
  }
  const base = await fs.realpath(settings.destination);
  const directory = path.join(base, 'Nota backups', id);
  if (create) await fs.ensureDir(directory);
  const resolved = await fs.realpath(directory);
  if (resolved !== directory || !isInside(base, resolved)) {
    throw new Error(
      'The backup folder must not contain redirected workspace directories.'
    );
  }
  return directory;
}

async function backupFiles(directory: string) {
  const files = await fs.readdir(directory);
  const candidates = await Promise.all(
    files
      .filter(name => BACKUP_FILENAME.test(name))
      .map(async name => {
        const stat = await fs.lstat(path.join(directory, name));
        return stat.isFile() && !stat.isSymbolicLink() ? { name, stat } : null;
      })
  );
  return candidates
    .filter((file): file is NonNullable<typeof file> => file !== null)
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function runLocalBackup(
  universalId: string,
  force = false
): Promise<LocalBackupPreferences> {
  const id = localWorkspaceId(universalId);
  if (typeof force !== 'boolean') throw new Error('Invalid backup request.');
  const pending = inFlight.get(id);
  if (pending) return pending;
  const run = (async () => {
    let settings = await getLocalBackupSettings(universalId);
    const now = Date.now();
    if (
      !force &&
      (!settings.enabled ||
        (settings.lastSuccess &&
          now >= settings.lastSuccess &&
          now - settings.lastSuccess < DAY) ||
        (settings.lastAttempt &&
          now >= settings.lastAttempt &&
          now - settings.lastAttempt < RETRY_INTERVAL))
    ) {
      return settings;
    }
    try {
      settings = await saveSettings(id, { ...settings, lastAttempt: now });
      const directory = await backupDirectory(id, settings, true);
      const filename = `backup-${new Date(now).toISOString().slice(0, 10)}.nota`;
      const pool = getDocStoragePool();
      await pool.connect(
        universalId,
        await getSpaceDBPath('local', 'workspace', id)
      );
      await pool.backup(universalId, path.join(directory, filename));
      const current = await getLocalBackupSettings(universalId);
      settings = await saveSettings(id, {
        ...current,
        lastAttempt: now,
        lastSuccess: now,
        lastError: undefined,
      });
      // Prune only after the native primitive has verified and published a new
      // complete snapshot. Unknown files and redirected files are never deleted.
      const files = await backupFiles(directory);
      const retained = new Set([
        filename,
        ...files
          .filter(file => file.name !== filename)
          .slice(0, RETAINED_BACKUPS - 1)
          .map(file => file.name),
      ]);
      for (const file of files.filter(file => !retained.has(file.name))) {
        await fs.unlink(path.join(directory, file.name));
      }
      return settings;
    } catch (error) {
      const current = await getLocalBackupSettings(universalId);
      return saveSettings(id, {
        ...current,
        lastAttempt: now,
        lastError:
          error instanceof Error ? error.message : 'The local backup failed.',
      });
    }
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
}

export async function listLocalBackups(universalId: string) {
  const id = localWorkspaceId(universalId);
  const settings = await getLocalBackupSettings(universalId);
  if (!settings.destination) return [];
  const directory = await backupDirectory(id, settings).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  );
  if (!directory) return [];
  const files = await backupFiles(directory);
  return Promise.all(
    files.map(async ({ name, stat }) => ({
      name,
      createdAt: stat.mtimeMs,
      size: stat.size,
      verified: await new DocStorage(path.join(directory, name))
        .validate()
        .catch(() => false),
    }))
  );
}

export async function restoreLocalBackup(
  universalId: string,
  filename: string
) {
  const id = localWorkspaceId(universalId);
  if (!BACKUP_FILENAME.test(filename))
    throw new Error('Invalid backup selection.');
  const directory = await backupDirectory(
    id,
    await getLocalBackupSettings(universalId)
  );
  const filePath = path.join(directory, filename);
  const stat = await fs.lstat(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !(await new DocStorage(filePath).validate())
  ) {
    throw new Error('This backup failed verification and cannot be restored.');
  }
  // The existing importer creates a new identity and leaves the current
  // workspace intact. The renderer never provides an arbitrary restore path.
  return loadDBFile(filePath);
}
