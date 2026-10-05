import { SettingRow } from '@nota/component/setting-components';
import { Button } from '@nota/component/ui/button';
import { useConfirmModal } from '@nota/component/ui/modal';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import { useCallback, useEffect, useState } from 'react';

type HistoryUsage = {
  versions: number;
  historyBytes: number;
  retainedRemovedBlobBytes: number;
};

export const LocalHistoryStoragePanel = () => {
  const workspace = useService(WorkspaceService).workspace;
  const storage = workspace.engine.doc.storage;
  const { openConfirmModal } = useConfirmModal();
  const [usage, setUsage] = useState<HistoryUsage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    if (
      !(await storage.isHistorySupported?.()) ||
      !storage.getHistoryStorageUsage
    )
      return;
    return storage.getHistoryStorageUsage();
  }, [storage]);
  useEffect(() => {
    let active = true;
    refresh()
      .then(usage => {
        if (active) setUsage(usage);
      })
      .catch(error => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'Could not read local history storage.'
          );
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const clear = useAsyncCallback(async () => {
    if (busy || !storage.clearHistories) return;
    setBusy(true);
    setError(undefined);
    try {
      await workspace.engine.doc.waitForUpdated();
      await storage.clearHistories();
      setUsage(await refresh());
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not clear local history.'
      );
    } finally {
      setBusy(false);
    }
  }, [busy, storage, workspace, refresh]);

  if (!usage && !error) return null;
  return (
    <>
      <SettingRow
        name="Page history on this device"
        desc={
          usage
            ? `${usage.versions} saved versions · ${(usage.historyBytes / 1024 / 1024).toFixed(1)} MB of history · ${(usage.retainedRemovedBlobBytes / 1024 / 1024).toFixed(1)} MB of removed files kept for recovery.`
            : 'Could not read local history storage.'
        }
      >
        <Button
          variant="error"
          disabled={
            busy ||
            !usage ||
            !storage.clearHistories ||
            !(usage.versions || usage.retainedRemovedBlobBytes)
          }
          loading={busy}
          onClick={() =>
            openConfirmModal({
              title: 'Delete local history and removed files?',
              description:
                'This permanently deletes all saved page versions in this workspace on this device and reclaims removed files no longer used by current pages. Current pages and their active files stay. Cleanup stops if Nota cannot safely check a page. Save a recovery backup first if you need these older versions.',
              confirmText: 'Delete history and removed files',
              onConfirm: clear,
            })
          }
        >
          Clear history and removed files
        </Button>
      </SettingRow>
      <p>
        Removed files stay available while history exists. Clearing history
        checks current pages before reclaiming unused files. The workspace file
        may keep its size. Editing creates new versions again.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
};
