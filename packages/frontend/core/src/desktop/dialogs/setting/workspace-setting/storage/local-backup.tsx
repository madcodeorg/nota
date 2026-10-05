import { notify, Switch } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';
import { Button } from '@nota/component/ui/button';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import {
  flushWorkspaceForBackup,
  LOCAL_BACKUP_UPDATED,
} from '@nota/core/desktop/pages/workspace/local-backup-side-effect';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import {
  type Workspace,
  WorkspacesService,
} from '@nota/core/modules/workspace';
import { _addLocalWorkspace } from '@nota/core/modules/workspace-engine';
import { useService } from '@nota/infra';
import { universalId } from '@nota/nbstore';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './local-backup.css';

type BackupSettings = Awaited<
  ReturnType<
    DesktopApiService['handler']['workspace']['getLocalBackupSettings']
  >
>;
type BackupList = Awaited<
  ReturnType<DesktopApiService['handler']['workspace']['listLocalBackups']>
>;

export const LocalBackupPanel = ({ workspace }: { workspace: Workspace }) => {
  const desktopApi = useService(DesktopApiService);
  const workspacesService = useService(WorkspacesService);
  const [settings, setSettings] = useState<BackupSettings>();
  const [backups, setBackups] = useState<BackupList>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const id = universalId({
    peer: 'local',
    type: 'workspace',
    id: workspace.id,
  });

  const refresh = useCallback(async () => {
    const [settings, backups] = await Promise.all([
      desktopApi.handler.workspace.getLocalBackupSettings(id),
      desktopApi.handler.workspace.listLocalBackups(id),
    ]);
    setSettings(settings);
    setBackups(backups);
  }, [desktopApi, id]);

  useEffect(() => {
    let disposed = false;
    const update = () => {
      void refresh().catch(error => {
        if (!disposed)
          setError(
            error instanceof Error ? error.message : 'Could not load backups.'
          );
      });
    };
    update();
    window.addEventListener(LOCAL_BACKUP_UPDATED, update);
    return () => {
      disposed = true;
      window.removeEventListener(LOCAL_BACKUP_UPDATED, update);
    };
  }, [refresh]);

  const run = useAsyncCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError(undefined);
      try {
        await action();
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'The backup operation failed.'
        );
      } finally {
        await refresh().catch(error =>
          setError(
            error instanceof Error
              ? error.message
              : 'Could not refresh backups.'
          )
        );
        setBusy(false);
      }
    },
    [busy, refresh]
  );

  const backUpNow = async () => {
    await flushWorkspaceForBackup(workspace);
    const result = await desktopApi.handler.workspace.runLocalBackup(id, true);
    if (result.lastError) throw new Error(result.lastError);
    notify.success({ title: 'Local backup verified and saved' });
  };

  return (
    <>
      <SettingRow
        name="Local recovery backups"
        desc="Choose a folder for complete workspace snapshots, including pages, databases and stored attachments. An external drive also protects against losing this disk."
      >
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await desktopApi.handler.workspace.selectLocalBackupFolder(id);
            })
          }
        >
          {settings?.destination ? 'Change folder' : 'Choose folder'}
        </Button>
      </SettingRow>
      {settings?.destination ? (
        <p className={styles.folder}>{settings.destination}</p>
      ) : null}
      <SettingRow
        name="Automatic daily backups"
        desc="While this local workspace is open, save a verified snapshot every 24 hours and keep seven daily copies. Backups also run when content has not changed."
      >
        <Switch
          checked={settings?.enabled ?? false}
          disabled={busy || !settings?.destination}
          onChange={enabled =>
            run(async () => {
              await desktopApi.handler.workspace.setLocalBackupEnabled(
                id,
                enabled
              );
              if (enabled) await backUpNow();
            })
          }
        >
          <span className={styles.switchLabel}>Automatic daily backups</span>
        </Switch>
      </SettingRow>
      <SettingRow
        name="Back up now"
        desc={
          settings?.lastSuccess
            ? `Last verified backup: ${new Date(settings.lastSuccess).toLocaleString()}`
            : 'No verified backup has been saved in this folder yet.'
        }
      >
        <Button
          disabled={busy || !settings?.destination}
          loading={busy}
          onClick={() => run(backUpNow)}
        >
          Back up now
        </Button>
      </SettingRow>
      {error || settings?.lastError ? (
        <p role="alert">{error || settings?.lastError}</p>
      ) : null}
      {backups.map(backup => (
        <SettingRow
          key={backup.name}
          name={new Date(backup.createdAt).toLocaleString()}
          desc={
            backup.verified
              ? `${Math.ceil(backup.size / 1024)} KB. Restore creates a separate workspace and keeps this one.`
              : 'Verification failed. This snapshot cannot be restored.'
          }
        >
          <Button
            disabled={busy || !backup.verified}
            onClick={() =>
              run(async () => {
                const result =
                  await desktopApi.handler.workspace.restoreLocalBackup(
                    id,
                    backup.name
                  );
                if (result.error || !result.workspaceId)
                  throw new Error(
                    result.error ?? 'The backup could not be restored.'
                  );
                _addLocalWorkspace(result.workspaceId);
                workspacesService.list.revalidate();
                notify.success({ title: 'Backup restored as a new workspace' });
              })
            }
          >
            Restore as new workspace
          </Button>
        </SettingRow>
      ))}
    </>
  );
};
