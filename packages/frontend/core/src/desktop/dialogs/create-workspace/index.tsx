import { Button, ConfirmModal, notify, RowInput } from '@nota/component';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import {
  AuthService,
  type Server,
  ServersService,
} from '@nota/core/modules/cloud';
import {
  type DialogComponentProps,
  type GLOBAL_DIALOG_SCHEMA,
  GlobalDialogService,
} from '@nota/core/modules/dialogs';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { WorkspacesService } from '@nota/core/modules/workspace';
import { buildShowcaseWorkspace } from '@nota/core/utils/first-app-data';
import { useI18n } from '@nota/i18n';
import { FrameworkScope, useLiveData, useService } from '@nota/infra';
import track from '@nota/track';
import { useCallback, useState } from 'react';

import * as styles from './index.css';
import { ServerSelector } from './server-selector';
import { initialWorkspaceCreationTarget } from './server-selector-options';

const FormSection = ({
  label,
  input,
}: {
  label: string;
  input: React.ReactNode;
}) => {
  return (
    <section className={styles.section}>
      <label className={styles.label}>{label}</label>
      {input}
    </section>
  );
};

export const CreateWorkspaceDialog = ({
  serverId,
  close,
  ...props
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['create-workspace']>) => {
  const t = useI18n();
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);

  const [workspaceName, setWorkspaceName] = useState('');
  const [inputServerId, setInputServerId] = useState(() =>
    initialWorkspaceCreationTarget(serverId, {
      googleConnected: googleStatus === 'connected',
      isElectron: BUILD_CONFIG.isElectron,
    })
  );

  const serversService = useService(ServersService);
  const server = useLiveData(
    inputServerId && inputServerId !== 'google-drive'
      ? serversService.server$(inputServerId)
      : null
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close]
  );

  return (
    <ConfirmModal
      open
      onOpenChange={onOpenChange}
      title={t['com.affine.nameWorkspace.title']()}
      description={t['com.affine.nameWorkspace.description']()}
      cancelText={t['com.affine.nameWorkspace.button.cancel']()}
      closeButtonOptions={{
        ['data-testid' as string]: 'create-workspace-close-button',
      }}
      contentOptions={{}}
      childrenContentClassName={styles.content}
      customConfirmButton={() => {
        return (
          <FrameworkScope scope={server?.scope}>
            <CustomConfirmButton
              workspaceName={workspaceName}
              server={server}
              selectedTargetId={inputServerId}
              onCreated={res =>
                close({ metadata: res.meta, defaultDocId: res.defaultDocId })
              }
            />
          </FrameworkScope>
        );
      }}
      {...props}
    >
      <FormSection
        label={t['com.affine.nameWorkspace.subtitle.workspace-name']()}
        input={
          <RowInput
            autoFocus
            className={styles.input}
            data-testid="create-workspace-input"
            placeholder={t['com.affine.nameWorkspace.placeholder']()}
            maxLength={64}
            minLength={0}
            onChange={setWorkspaceName}
          />
        }
      />

      <FormSection
        label={t['com.affine.nameWorkspace.subtitle.workspace-type']()}
        input={
          <ServerSelector
            className={styles.select}
            selectedId={inputServerId}
            onChange={setInputServerId}
          />
        }
      />
    </ConfirmModal>
  );
};

const CustomConfirmButton = ({
  workspaceName,
  server,
  selectedTargetId,
  onCreated,
}: {
  workspaceName: string;
  server?: Server | null;
  selectedTargetId: string;
  onCreated: (res: Awaited<ReturnType<typeof buildShowcaseWorkspace>>) => void;
}) => {
  const t = useI18n();
  const [loading, setLoading] = useState(false);

  const session = useService(AuthService).session;
  const loginStatus = useLiveData(session.status$);
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);
  const globalDialogService = useService(GlobalDialogService);
  const workspacesService = useService(WorkspacesService);

  const openSignInModal = useCallback(() => {
    globalDialogService.open(
      'sign-in',
      selectedTargetId === 'google-drive' ? {} : { server: server?.baseUrl }
    );
  }, [globalDialogService, selectedTargetId, server?.baseUrl]);

  const handleConfirm = useAsyncCallback(async () => {
    if (loading) return;
    setLoading(true);
    const flavour = selectedTargetId === 'local' ? 'local' : selectedTargetId;
    track.$.$.$.createWorkspace({
      flavour,
    });

    // this will be the last step for web for now
    // fix me later
    try {
      const res = await buildShowcaseWorkspace(
        workspacesService,
        flavour,
        workspaceName
      );
      onCreated(res);
    } catch (e) {
      console.error(e);
      notify.error({
        title: 'Failed to create workspace',
        message: 'please try again later.',
      });
    } finally {
      setLoading(false);
    }
  }, [loading, onCreated, selectedTargetId, workspaceName, workspacesService]);

  const handleCheckSessionAndConfirm = useCallback(() => {
    if (selectedTargetId === 'google-drive' && googleStatus !== 'connected') {
      return openSignInModal();
    }
    if (server && loginStatus !== 'authenticated') {
      return openSignInModal();
    }
    handleConfirm();
  }, [
    googleStatus,
    handleConfirm,
    loginStatus,
    openSignInModal,
    selectedTargetId,
    server,
  ]);

  return (
    <Button
      disabled={!workspaceName}
      data-testid="create-workspace-create-button"
      variant="primary"
      onClick={handleCheckSessionAndConfirm}
      loading={loading}
    >
      {t['com.affine.nameWorkspace.button.create']()}
    </Button>
  );
};
