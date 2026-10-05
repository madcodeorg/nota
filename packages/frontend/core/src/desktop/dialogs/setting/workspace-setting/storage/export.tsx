import { ExportIcon } from '@blocksuite/icons/rc';
import { notify } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';
import { Button } from '@nota/component/ui/button';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { flushWorkspaceForBackup } from '@nota/core/desktop/pages/workspace/local-backup-side-effect';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import type { Workspace } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import { universalId } from '@nota/nbstore';
import track from '@nota/track';
import { useState } from 'react';

import { LocalBackupPanel } from './local-backup';

interface ExportPanelProps {
  workspace: Workspace;
}

export const DesktopExportPanel = ({ workspace }: ExportPanelProps) => {
  const t = useI18n();
  const [saving, setSaving] = useState(false);
  const desktopApi = useService(DesktopApiService);
  const isLocalWorkspace = workspace.flavour === 'local';

  const [fullSyncing, setFullSyncing] = useState(false);
  const [fullSynced, setFullSynced] = useState(isLocalWorkspace);

  const fullSync = useAsyncCallback(async () => {
    setFullSyncing(true);
    await workspace.engine.blob.fullDownload();
    await workspace.engine.doc.waitForSynced();
    setFullSynced(true);
    setFullSyncing(false);
  }, [workspace.engine.blob, workspace.engine.doc]);

  const onExport = useAsyncCallback(async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      track.$.settingsPanel.workspace.export({
        type: 'workspace',
      });

      await flushWorkspaceForBackup(workspace);

      const result = await desktopApi.handler?.dialog.saveDBFileAs(
        universalId({
          peer: workspace.flavour,
          type: 'workspace',
          id: workspace.id,
        }),
        workspace.name$.getValue() ?? 'db'
      );
      if (result?.error) {
        throw new Error(result.error);
      } else if (!result?.canceled) {
        notify.success({ title: t['Export success']() });
      }
    } catch (e: any) {
      notify.error({ title: t['Export failed'](), message: e.message });
    } finally {
      setSaving(false);
    }
  }, [desktopApi, saving, t, workspace]);

  if (fullSynced) {
    return (
      <>
        {isLocalWorkspace ? <LocalBackupPanel workspace={workspace} /> : null}
        <SettingRow
          name={t['Full Backup']()}
          desc={t['Full Backup Description']()}
        >
          <Button
            variant="primary"
            data-testid="export-affine-backup"
            onClick={onExport}
            disabled={saving}
          >
            {t['Full Backup']()}
          </Button>
        </SettingRow>
      </>
    );
  }

  return (
    <>
      <SettingRow
        name={t['Full Backup']()}
        desc={
          fullSynced ? t['Full Backup Description']() : t['Full Backup Hint']()
        }
      >
        <Button
          variant="primary"
          data-testid="export-affine-full-sync"
          onClick={fullSync}
          loading={fullSyncing}
          disabled={fullSyncing}
          prefix={<ExportIcon />}
        >
          {t['Full Backup']()}
        </Button>
      </SettingRow>
      <SettingRow
        name={t['Quick Export']()}
        desc={t['Quick Export Description']()}
      >
        <Button
          data-testid="export-affine-backup"
          onClick={onExport}
          disabled={saving}
        >
          {t['Quick Export']()}
        </Button>
      </SettingRow>
    </>
  );
};
