import { SettingRow } from '@nota/component/setting-components';
import { Button } from '@nota/component/ui/button';
import { useNavigateHelper } from '@nota/core/components/hooks/use-navigate-helper';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import {
  type WorkspaceMetadata,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { WorkspaceTransformService } from '@nota/core/modules/workspace/services/transform';
import {
  getGoogleDriveWorkspaceOwner,
  isGoogleDriveWorkspaceSyncPaused,
  setGoogleDriveWorkspaceSyncPaused,
} from '@nota/core/modules/workspace-engine/impls/google-drive';
import { useLiveData, useService } from '@nota/infra';
import { useEffect, useRef, useState } from 'react';

export const GoogleDriveStoragePanel = ({
  onConnected,
}: {
  onConnected?: (metadata: WorkspaceMetadata) => void | Promise<void>;
}) => {
  const workspace = useService(WorkspaceService).workspace;
  const auth = useService(GoogleAuthService);
  const transform = useService(WorkspaceTransformService);
  const { jumpToPage } = useNavigateHelper();
  const user = useLiveData(auth.session.userInfo$);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(() =>
    isGoogleDriveWorkspaceSyncPaused(workspace.id)
  );
  const owner = getGoogleDriveWorkspaceOwner(workspace.id);
  const isDrive = workspace.flavour === 'google-drive';
  const matchingAccount = user?.sub === owner;
  const lifecycle = useRef(0);

  useEffect(() => {
    const lifecycleRef = lifecycle;
    lifecycleRef.current++;
    return () => {
      lifecycleRef.current++;
    };
  }, [workspace.id]);

  useEffect(() => {
    const channel = new BroadcastChannel('nota-google-drive-workspace-changed');
    const update = () =>
      setPaused(isGoogleDriveWorkspaceSyncPaused(workspace.id));
    channel.addEventListener('message', update);
    return () => channel.close();
  }, [workspace.id]);

  const run = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (busy) return;
    const current = lifecycle.current;
    const isCurrent = () => current === lifecycle.current;
    setBusy(true);
    setError(null);
    try {
      await action(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      setError(
        error instanceof Error
          ? error.message
          : 'Google Drive setup failed. Your local content is available.'
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const connect = () =>
    run(async isCurrent => {
      if (!user || (isDrive && !matchingAccount)) await auth.connect();
      if (!isCurrent()) return;
      if (isDrive) {
        if (!owner || auth.session.userInfo$.value?.sub !== owner)
          throw new Error(
            'Reconnect the Google account that owns this workspace. Your local content stays available.'
          );
        setGoogleDriveWorkspaceSyncPaused(workspace.id, false);
        setPaused(false);
        await onConnected?.(workspace.meta);
      } else {
        const metadata = await transform.transformLocalToCloud(
          workspace,
          null,
          'google-drive'
        );
        // A user can skip or close setup while copying. The verified copy and
        // original remain available; stale completion must not reopen setup.
        if (!isCurrent()) return;
        await onConnected?.(metadata);
        if (!isCurrent()) return;
        jumpToPage(metadata.id, 'all');
      }
    });

  return (
    <>
      <SettingRow
        name="Google Drive sync"
        desc={
          isDrive
            ? paused
              ? 'Sync is disconnected. Your cached workspace remains available locally.'
              : !matchingAccount
                ? 'Saved locally. Reconnect the Google account that owns this workspace to sync.'
                : 'Sync uses your own Google Drive. Offline changes stay on this device until it reconnects.'
            : 'Optional. Keep a synced copy in your own Google Drive. Your original local workspace is retained.'
        }
      >
        {!isDrive || paused || !matchingAccount ? (
          <Button disabled={busy} onClick={() => void connect()}>
            {isDrive ? 'Reconnect sync' : 'Connect Google Drive'}
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={() =>
              void run(async isCurrent => {
                setGoogleDriveWorkspaceSyncPaused(workspace.id, true);
                await workspace.engine.client?.setGoogleDriveTokens(null);
                if (isCurrent()) setPaused(true);
              })
            }
          >
            Disconnect sync
          </Button>
        )}
      </SettingRow>
      {isDrive ? (
        <SettingRow
          name="Keep a local copy"
          desc="Create a separate local workspace from the pages and attachments available on this device. Drive files remain in your account."
        >
          <Button
            disabled={busy}
            onClick={() =>
              void run(async isCurrent => {
                const metadata =
                  await transform.transformDriveToLocal(workspace);
                if (!isCurrent()) return;
                jumpToPage(metadata.id, 'all');
              })
            }
          >
            Keep a local copy
          </Button>
        </SettingRow>
      ) : null}
      {busy ? (
        <p role="status">
          Preparing workspace. Your original content remains available.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
};
