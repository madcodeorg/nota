import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { type Workspace, WorkspaceService } from '@nota/core/modules/workspace';
import { copyLatestBackupToDrive } from '@nota/core/modules/workspace-engine/impls/google-drive-maintenance';
import { useService } from '@nota/infra';
import { universalId } from '@nota/nbstore';
import { useEffect } from 'react';

export const LOCAL_BACKUP_UPDATED = 'nota-local-backup-updated';

export async function flushWorkspaceForBackup(
  workspace: Workspace,
  signal?: AbortSignal
) {
  await workspace.engine.doc.waitForUpdated(workspace.rootYDoc.guid, signal);
  await workspace.engine.doc.waitForUpdated(undefined, signal);
}

const DesktopLocalBackupSideEffect = () => {
  const workspace = useService(WorkspaceService).workspace;
  const desktopApi = useService(DesktopApiService);
  const auth = useService(GoogleAuthService);

  useEffect(() => {
    if (workspace.flavour !== 'local') return;
    const id = universalId({
      peer: 'local',
      type: 'workspace',
      id: workspace.id,
    });
    const controller = new AbortController();
    let running = false;

    const check = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const settings =
          await desktopApi.handler.workspace.getLocalBackupSettings(id);
        // Also retries a Drive copy that failed earlier, e.g. while offline.
        if (settings.enabled && settings.lastSuccess)
          await copyLatestBackupToDrive(
            desktopApi.handler.workspace,
            auth,
            workspace.id,
            id
          );
        if (
          !settings.enabled ||
          controller.signal.aborted ||
          (settings.lastSuccess &&
            Date.now() >= settings.lastSuccess &&
            Date.now() - settings.lastSuccess < 24 * 60 * 60 * 1000) ||
          (settings.lastAttempt &&
            Date.now() >= settings.lastAttempt &&
            Date.now() - settings.lastAttempt < 10 * 60 * 1000)
        )
          return;
        await flushWorkspaceForBackup(workspace, controller.signal);
        if (controller.signal.aborted) return;
        const result = await desktopApi.handler.workspace.runLocalBackup(id);
        if (!result.lastError && !controller.signal.aborted)
          await copyLatestBackupToDrive(
            desktopApi.handler.workspace,
            auth,
            workspace.id,
            id
          );
        if (!controller.signal.aborted)
          window.dispatchEvent(new Event(LOCAL_BACKUP_UPDATED));
      } catch {
        // Failed local saves already have a visible recovery banner. Native
        // backup failures are recorded in the workspace's backup preferences.
      } finally {
        running = false;
      }
    };
    const onFocus = () => {
      check().catch(() => undefined);
    };
    onFocus();
    const interval = window.setInterval(onFocus, 10 * 60 * 1000);
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [auth, desktopApi, workspace]);

  return null;
};

export const LocalBackupSideEffect = () =>
  BUILD_CONFIG.isElectron ? <DesktopLocalBackupSideEffect /> : null;
