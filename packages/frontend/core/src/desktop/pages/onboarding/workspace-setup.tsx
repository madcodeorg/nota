import { Modal } from '@nota/component/ui/modal';
import { notify } from '@nota/component/ui/notification';
import { useNavigateHelper } from '@nota/core/components/hooks/use-navigate-helper';
import { AIModelService } from '@nota/core/modules/ai-button/services/models';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import type { SettingTab } from '@nota/core/modules/dialogs/constant';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import {
  isUserOwnedWorkspaceFlavour,
  type WorkspaceMetadata,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { WorkspaceTransformService } from '@nota/core/modules/workspace/services/transform';
import { useService } from '@nota/infra';
import { useEffect, useRef, useState } from 'react';

import { GoogleDriveStoragePanel } from '../../dialogs/setting/workspace-setting/storage/google-drive';
import * as styles from './nota-welcome.css';
import { NotaSetupPanel } from './setup-panel';
import {
  getWelcomeState,
  type SetupStep,
  updateWelcomeState,
  updateWorkspaceSetupState,
  useWelcomeState,
  useWorkspaceSetupState,
} from './setup-state';

function useWorkspaceSetup(onClose: () => void) {
  const workspace = useService(WorkspaceService).workspace;
  const dialogs = useService(WorkspaceDialogService);
  const aiModels = useService(AIModelService);
  const state = useWorkspaceSetupState(workspace.id);
  const welcome = useWelcomeState();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importOpen = useRef(false);
  const step = state.setupStep ?? welcome.setupStep ?? 'drive';
  const imported = state.imported || (welcome.showSetup && welcome.imported);

  const checkPreferences = (...saved: boolean[]) => {
    setError(
      saved.every(Boolean)
        ? null
        : 'Setup preferences could not be saved. Your choices remain available for this session. You can start working and try again later.'
    );
  };
  const onStepChange = (setupStep: SetupStep) => {
    checkPreferences(
      updateWorkspaceSetupState(workspace.id, { setupStep }),
      updateWelcomeState({ setupStep })
    );
  };
  const onConnected = (metadata: WorkspaceMetadata) => {
    // The storage panel navigates after this callback. Resume the wizard in
    // that workspace without authenticating or copying again on mount.
    checkPreferences(
      updateWorkspaceSetupState(metadata.id, {
        setupStep: 'transcription',
        ...(imported ? { imported: true } : {}),
      }),
      updateWelcomeState({
        setupStep: 'transcription',
        showSetup: true,
      })
    );
  };
  const onImport = () => {
    if (importOpen.current) return;
    importOpen.current = true;
    setImporting(true);
    setError(null);
    onStepChange('import');
    try {
      dialogs.open('import', undefined, result => {
        importOpen.current = false;
        setImporting(false);
        if (!result?.docIds.length && !result?.isWorkspaceFile) return;
        checkPreferences(
          updateWorkspaceSetupState(workspace.id, {
            setupStep: 'import',
            imported: true,
          }),
          updateWelcomeState({
            setupStep: 'import',
            imported: true,
            // Workspace backups open a different workspace. Preserve the
            // completed import there before that navigation happens.
            ...(result.isWorkspaceFile ? { showSetup: true } : {}),
          })
        );
      });
    } catch (error) {
      importOpen.current = false;
      setImporting(false);
      throw error;
    }
  };
  const onFinish = () => {
    updateWorkspaceSetupState(workspace.id, {
      finished: true,
      ...(imported ? { imported: true } : {}),
    });
    updateWelcomeState({ showSetup: false, action: undefined });
    onClose();
  };

  return {
    importing,
    error,
    panel: {
      step,
      onChatSelected: async (id: string) => {
        await aiModels.refreshModels();
        aiModels.setModel(`local:${id}`);
      },
      onChatAction: async (id: string, action: 'download' | 'probe') => {
        if (action === 'download') aiModels.watchLocalModelDownload(id);
        else await aiModels.refreshModels();
      },
      onStepChange,
      onFinish,
      onImport,
      imported,
      driveContent: <GoogleDriveStoragePanel onConnected={onConnected} />,
    },
  };
}

/** Settings re-entry uses the same setup steps without replaying the welcome. */
export function NotaSetupSettings({
  onClose,
}: {
  onClose: () => void;
  onNavigate: (tab: SettingTab) => void;
}) {
  const setup = useWorkspaceSetup(onClose);
  if (setup.importing) return null;
  return (
    <>
      {setup.error ? (
        <p className={styles.error} role="alert">
          {setup.error}
        </p>
      ) : null}
      <NotaSetupPanel {...setup.panel} />
    </>
  );
}

// How long to wait for the secure Google session to load in a new window.
const DRIVE_SESSION_WAIT_MS = 20_000;

/**
 * Finishes choices made in the first-launch card that need a workspace:
 * copying it to Google Drive, then opening the importer.
 */
function usePendingWelcomeChoices() {
  const workspace = useService(WorkspaceService).workspace;
  const dialogs = useService(WorkspaceDialogService);
  const auth = useService(GoogleAuthService);
  const transform = useService(WorkspaceTransformService);
  const { jumpToPage } = useNavigateHelper();
  useEffect(() => {
    if (!isUserOwnedWorkspaceFlavour(workspace.flavour)) return;
    const openImport = () => {
      if (!getWelcomeState().pendingImport) return;
      updateWelcomeState({ pendingImport: false });
      dialogs.open('import', undefined, () => undefined);
    };
    if (!getWelcomeState().pendingDrive) {
      openImport();
      return;
    }
    if (workspace.flavour !== 'local') {
      updateWelcomeState({ pendingDrive: false });
      openImport();
      return;
    }
    let started = false;
    // Each flag is cleared before its action starts so a remount or a second
    // window never repeats the copy.
    const subscription = auth.session.userInfo$.subscribe(user => {
      if (!user || started) return;
      started = true;
      updateWelcomeState({ pendingDrive: false });
      transform
        .transformLocalToCloud(workspace, null, 'google-drive')
        // The importer opens in the Drive workspace after this navigation.
        .then(metadata => jumpToPage(metadata.id, 'all'))
        .catch(error => {
          notify.error({
            title: 'Google Drive copy failed',
            message: `${error instanceof Error ? error.message : String(error)} Your local workspace is unchanged. You can try again from Settings.`,
          });
          openImport();
        });
    });
    const timeout = window.setTimeout(() => {
      if (started) return;
      started = true;
      subscription.unsubscribe();
      updateWelcomeState({ pendingDrive: false });
      notify({
        title: 'Google Drive is not connected',
        message: 'Connect Google Drive from Settings to sync this workspace.',
      });
      openImport();
    }, DRIVE_SESSION_WAIT_MS);
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [workspace, dialogs, auth, transform, jumpToPage]);
}

/** Resumes an older in-workspace setup and finishes first-launch choices. */
export function WorkspaceSetup() {
  const workspace = useService(WorkspaceService).workspace;
  const [open, setOpen] = useState(false);
  const setup = useWorkspaceSetup(() => setOpen(false));
  usePendingWelcomeChoices();
  useEffect(() => {
    // Only re-open on entering a workspace. Preference updates made by the
    // Settings version must not open a second wizard over that dialog.
    setOpen(
      isUserOwnedWorkspaceFlavour(workspace.flavour) &&
        getWelcomeState().showSetup === true
    );
  }, [workspace.id, workspace.flavour]);

  return (
    <Modal
      open={open && !setup.importing}
      onOpenChange={nextOpen => {
        if (!nextOpen && !setup.importing) setup.panel.onFinish();
      }}
      width={880}
      withoutCloseButton
      animation="slideBottom"
      overlayOptions={{
        style: {
          backgroundColor: 'rgba(18, 24, 15, .42)',
          backdropFilter: 'blur(5px)',
        },
      }}
      contentWrapperStyle={{
        alignItems: 'flex-end',
        paddingBottom: '7vh',
      }}
      contentOptions={{
        'aria-label': 'Set up Nota',
        'aria-labelledby': undefined,
        style: { padding: 0, maxHeight: '90dvh', overflowY: 'auto' },
      }}
    >
      {open && !setup.importing ? (
        <>
          {setup.error ? (
            <p className={styles.error} role="alert">
              {setup.error}
            </p>
          ) : null}
          <NotaSetupPanel {...setup.panel} focusHeading />
        </>
      ) : null}
    </Modal>
  );
}
