import { afterEach, describe, expect, test, vi } from 'vitest';

import { FakeDrive } from './__tests__/fake-drive';
import { GoogleDriveBlobStorage } from './blob';
import { GoogleDriveConnection } from './connection';
import { driveContentHash } from './doc';
import {
  cleanUpDriveAttachments,
  DRIVE_UNUSED_GRACE_MS,
  getDriveUsage,
  listDriveBackups,
  uploadDriveBackup,
} from './maintenance';

const tokens = {
  accessToken: 'owner-access',
  accountId: 'owner',
  expiresAt: Date.now() + 3600000,
};
const connections: GoogleDriveConnection[] = [];
afterEach(() => {
  connections.splice(0).forEach(connection => connection.disconnect(true));
  vi.unstubAllGlobals();
});

async function setup() {
  const drive = new FakeDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const connection = new GoogleDriveConnection({ accountId: 'owner', tokens });
  connections.push(connection);
  connection.connect();
  await connection.waitForConnected();
  const id = crypto.randomUUID();
  const blobs = new GoogleDriveBlobStorage({ id, accountId: 'owner', tokens });
  Object.defineProperty(blobs, 'connection', { value: connection });
  return { drive, connection, id, blobs };
}

const blob = (key: string, bytes = 4) => ({
  key,
  data: new Uint8Array(bytes).fill(7),
  mime: 'image/png',
});

describe('Drive maintenance', () => {
  test('unused attachments wait 30 days before deletion and can be restored', async () => {
    const { drive, connection, id, blobs } = await setup();
    await blobs.set(blob('used'));
    await blobs.set(blob('old', 10));
    await blobs.set(blob('back'));
    const start = Date.UTC(2026, 9, 1);
    expect(
      await cleanUpDriveAttachments(connection, id, new Set(['used']), start)
    ).toMatchObject({ marked: 2, deleted: 0 });
    // A page uses "back" again before the wait ends.
    expect(
      await cleanUpDriveAttachments(
        connection,
        id,
        new Set(['used', 'back']),
        start + 1000
      )
    ).toMatchObject({ restored: 1, waiting: 1, deleted: 0 });
    expect(drive.requests.some(r => r.method === 'DELETE')).toBe(false);
    expect(
      await cleanUpDriveAttachments(
        connection,
        id,
        new Set(['used']),
        start + DRIVE_UNUSED_GRACE_MS
      )
    ).toMatchObject({ deleted: 1, marked: 1, freedBytes: 10 });
    expect(await blobs.get('old')).toBeNull();
    expect(await blobs.get('used')).not.toBeNull();
    expect(await blobs.get('back')).not.toBeNull();
  });

  test('uploading a marked attachment again clears its mark', async () => {
    const { connection, id, blobs } = await setup();
    await blobs.set(blob('image'));
    await cleanUpDriveAttachments(connection, id, new Set(), 0);
    await blobs.set(blob('image'));
    expect(
      await cleanUpDriveAttachments(
        connection,
        id,
        new Set(),
        DRIVE_UNUSED_GRACE_MS
      )
    ).toMatchObject({ marked: 1, deleted: 0 });
  });

  test('backup copies keep the newest seven and replace a changed same-day copy', async () => {
    const { connection, id } = await setup();
    for (let day = 1; day <= 9; day++)
      await uploadDriveBackup(
        connection,
        id,
        `backup-2026-10-0${day}.nota`,
        new Uint8Array([day])
      );
    let names = (await listDriveBackups(connection, id)).map(f => f.name);
    expect(names).toHaveLength(7);
    expect(names[0]).toContain('2026-10-09');
    expect(names.at(-1)).toContain('2026-10-03');
    await uploadDriveBackup(
      connection,
      id,
      'backup-2026-10-09.nota',
      new Uint8Array([9, 9])
    );
    names = (await listDriveBackups(connection, id)).map(f => f.name);
    expect(names).toHaveLength(7);
    expect(names.filter(name => name.includes('2026-10-09'))).toHaveLength(1);
    const usage = await getDriveUsage(connection, id);
    expect(usage).toMatchObject({ backupFiles: 7, accountLimit: 5000 });
  });

  test('large backups upload in resumable chunks', async () => {
    const { connection, id, drive } = await setup();
    const content = new Uint8Array(9 * 1024 * 1024).fill(3);
    const file = await uploadDriveBackup(
      connection,
      id,
      'backup-2026-10-10.nota',
      content
    );
    expect(Number(file.size)).toBe(content.length);
    expect(
      drive.requests.filter(r => r.method === 'PUT').length
    ).toBeGreaterThan(1);
    expect(await driveContentHash(drive.files.get(file.id)!.content)).toBe(
      await driveContentHash(content)
    );
  });
});
