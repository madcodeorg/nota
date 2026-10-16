import {
  type DriveFile,
  driveQueryValue,
  type GoogleDriveConnection,
} from './connection';
import { driveContentHash } from './doc';

export const DRIVE_UNUSED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const DRIVE_BACKUPS_RETAINED = 7;

const size = (files: DriveFile[]) =>
  files.reduce((total, file) => total + Number(file.size ?? 0), 0);

function backupPrefix(workspaceId: string) {
  return `nota_backup_${workspaceId}_`;
}

async function filesWithPrefix(
  connection: GoogleDriveConnection,
  prefix: string
) {
  const files = await connection.searchFiles(
    `name contains '${driveQueryValue(prefix)}' and trashed = false`
  );
  return files.filter(file => file.name.startsWith(prefix));
}

export interface DriveUsage {
  /** Whole Google account, including Gmail and Photos. */
  accountUsage: number;
  accountLimit: number;
  syncBytes: number;
  syncFiles: number;
  backupBytes: number;
  backupFiles: number;
}

export async function getDriveUsage(
  connection: GoogleDriveConnection,
  workspaceId: string
): Promise<DriveUsage> {
  const [quota, sync, backups] = await Promise.all([
    connection.getQuota(),
    filesWithPrefix(connection, `ws_${workspaceId}_`),
    filesWithPrefix(connection, backupPrefix(workspaceId)),
  ]);
  return {
    accountUsage: quota.usage,
    accountLimit: quota.limit,
    syncBytes: size(sync),
    syncFiles: sync.length,
    backupBytes: size(backups),
    backupFiles: backups.length,
  };
}

export interface DriveAttachmentCleanup {
  marked: number;
  deleted: number;
  restored: number;
  waiting: number;
  freedBytes: number;
}

/**
 * Attachments no page uses are first marked, and deleted only when they are
 * still unused 30 days later. Another device can still be offline with a page
 * that uses one; re-uploading or using it again clears the mark.
 */
export async function cleanUpDriveAttachments(
  connection: GoogleDriveConnection,
  workspaceId: string,
  usedKeys: ReadonlySet<string>,
  now = Date.now()
): Promise<DriveAttachmentCleanup> {
  const prefix = `ws_${workspaceId}_blob_`;
  const result = {
    marked: 0,
    deleted: 0,
    restored: 0,
    waiting: 0,
    freedBytes: 0,
  };
  for (const file of await filesWithPrefix(connection, prefix)) {
    const key = file.name.slice(prefix.length);
    const since = Number(file.properties?.['unusedSince']);
    if (usedKeys.has(key)) {
      if (file.properties?.['unusedSince']) {
        await connection.updateFileProperties(file.id, { unusedSince: null });
        result.restored++;
      }
    } else if (!Number.isFinite(since) || !file.properties?.['unusedSince']) {
      await connection.updateFileProperties(file.id, {
        unusedSince: String(now),
      });
      result.marked++;
    } else if (now - since >= DRIVE_UNUSED_GRACE_MS) {
      await connection.deleteFile(file.id);
      result.deleted++;
      result.freedBytes += Number(file.size ?? 0);
    } else {
      result.waiting++;
    }
  }
  return result;
}

/**
 * Copy a verified local backup into the app folder, then keep only the newest
 * copies. Older copies are removed only after the new one is confirmed.
 */
export async function uploadDriveBackup(
  connection: GoogleDriveConnection,
  workspaceId: string,
  filename: string,
  content: Uint8Array,
  retained = DRIVE_BACKUPS_RETAINED
): Promise<DriveFile> {
  const prefix = backupPrefix(workspaceId);
  const name = `${prefix}${filename}`;
  const sha256 = await driveContentHash(content);
  const existing = await filesWithPrefix(connection, prefix);
  const same = existing.find(
    file => file.name === name && file.properties?.['sha256'] === sha256
  );
  const uploaded =
    same ??
    (await connection.createFile(name, content, 'application/octet-stream', {
      workspaceId,
      kind: 'backup',
      sha256,
    }));
  if (Number(uploaded.size) !== content.byteLength)
    throw new Error('The Google Drive backup copy could not be verified.');
  // Backup names sort by date. A same-day copy with other content is replaced.
  const keep = new Set(
    [uploaded, ...existing.filter(file => file.name !== name)]
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, retained)
      .map(file => file.id)
  );
  for (const file of existing)
    if (!keep.has(file.id)) await connection.deleteFile(file.id);
  return uploaded;
}

export async function listDriveBackups(
  connection: GoogleDriveConnection,
  workspaceId: string
): Promise<DriveFile[]> {
  return (await filesWithPrefix(connection, backupPrefix(workspaceId))).sort(
    (a, b) => b.name.localeCompare(a.name)
  );
}
