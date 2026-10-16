import { SettingRow } from '@nota/component/setting-components';
import { Button } from '@nota/component/ui/button';
import { BlobManagementService } from '@nota/core/modules/blob-management/services';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { getGoogleDriveWorkspaceOwner } from '@nota/core/modules/workspace-engine/impls/google-drive';
import { withGoogleDrive } from '@nota/core/modules/workspace-engine/impls/google-drive-maintenance';
import { useLiveData, useService } from '@nota/infra';
import {
  cleanUpDriveAttachments,
  type DriveAttachmentCleanup,
  type DriveUsage,
  getDriveUsage,
} from '@nota/nbstore/google-drive';
import { useState } from 'react';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function cleanupSummary(result: DriveAttachmentCleanup): string {
  const parts = [];
  if (result.deleted)
    parts.push(
      `Deleted ${result.deleted} attachment${result.deleted === 1 ? '' : 's'} (${formatBytes(result.freedBytes)}).`
    );
  if (result.marked)
    parts.push(
      `${result.marked} unused attachment${result.marked === 1 ? '' : 's'} will be deleted if still unused in 30 days.`
    );
  if (result.waiting)
    parts.push(`${result.waiting} already waiting for deletion.`);
  if (result.restored) parts.push(`${result.restored} in use again and kept.`);
  return parts.join(' ') || 'Every attachment in Google Drive is in use.';
}

/** Usage and cleanup for a workspace that syncs with the owner's Google Drive. */
export const GoogleDriveMaintenancePanel = () => {
  const workspace = useService(WorkspaceService).workspace;
  const auth = useService(GoogleAuthService);
  const blobManagement = useService(BlobManagementService);
  const user = useLiveData(auth.session.userInfo$);
  const owner = getGoogleDriveWorkspaceOwner(workspace.id);
  const [usage, setUsage] = useState<DriveUsage>();
  const [cleanup, setCleanup] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canUseDrive = !!user && !!owner && user.sub === owner;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Google Drive is unavailable. Your local content is unaffected.'
      );
    } finally {
      setBusy(false);
    }
  };

  const checkUsage = () =>
    run(async () => {
      setUsage(
        await withGoogleDrive(
          auth,
          connection => getDriveUsage(connection, workspace.id),
          owner
        )
      );
    });

  const cleanUp = () =>
    run(async () => {
      const used = await blobManagement.unusedBlobs.getUsedBlobKeys();
      const result = await withGoogleDrive(
        auth,
        connection => cleanUpDriveAttachments(connection, workspace.id, used),
        owner
      );
      setCleanup(cleanupSummary(result));
    });

  return (
    <>
      <SettingRow
        name="Google Drive usage"
        desc={
          usage
            ? `This workspace uses ${formatBytes(usage.syncBytes)} in ${usage.syncFiles} sync files and ${formatBytes(usage.backupBytes)} in ${usage.backupFiles} backup copies. Your Google account uses ${formatBytes(usage.accountUsage)}${usage.accountLimit ? ` of ${formatBytes(usage.accountLimit)}` : ''}. Old page edits are combined automatically.`
            : 'See how much space this workspace uses in your Google Drive.'
        }
      >
        <Button
          disabled={busy || !canUseDrive}
          onClick={() => void checkUsage()}
        >
          Check usage
        </Button>
      </SettingRow>
      <SettingRow
        name="Clean up unused attachments"
        desc={
          cleanup ??
          'Marks attachments no page uses, and deletes them from Google Drive only if they are still unused 30 days later. Copies on this device are kept.'
        }
      >
        <Button disabled={busy || !canUseDrive} onClick={() => void cleanUp()}>
          Clean up
        </Button>
      </SettingRow>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
};
