import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { type Workspace, WorkspaceService } from '@nota/core/modules/workspace';
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
        await desktopApi.handler.workspace.runLocalBackup(id);
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
  }, [desktopApi, workspace]);

  return null;
};

export const LocalBackupSideEffect = () =>
  BUILD_CONFIG.isElectron ? <DesktopLocalBackupSideEffect /> : null;
