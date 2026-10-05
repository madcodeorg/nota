import { notify, useConfirmModal } from '@nota/component';
import { GlobalDialogService } from '@nota/core/modules/dialogs';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import type { Workspace } from '@nota/core/modules/workspace';
import { WorkspacesService } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { useCallback } from 'react';

import { useNavigateHelper } from '../use-navigate-helper';

interface ConfirmEnableCloudOptions {
  /**
   * Fired when the workspace is successfully enabled
   */
  onSuccess?: () => void;
  /**
   * Fired when workspace is successfully enabled or user cancels the operation
   */
  onFinished?: () => void;
  openPageId?: string;
  serverId?: string;
}
type ConfirmEnableArgs = [Workspace, ConfirmEnableCloudOptions | undefined];

export const useEnableCloud = () => {
  const t = useI18n();
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);
  const globalDialogService = useService(GlobalDialogService);
  const { openConfirmModal, closeConfirmModal } = useConfirmModal();
  const workspacesService = useService(WorkspacesService);

  const { jumpToPage } = useNavigateHelper();

  const enableCloud = useCallback(
    async (ws: Workspace | null, options?: ConfirmEnableCloudOptions) => {
      try {
        if (!ws) return;
        const { id: newId } = await workspacesService.transformLocalToCloud(
          ws,
          null,
          'google-drive'
        );
        jumpToPage(newId, options?.openPageId || 'all');
        options?.onSuccess?.();
      } catch (e) {
        console.error(e);
        notify.error({
          title: 'Could not set up Google Drive backup',
        });
      }
    },
    [jumpToPage, workspacesService]
  );

  const openSignIn = useCallback(
    () =>
      globalDialogService.open('sign-in', {
        step: 'signIn',
      }),
    [globalDialogService]
  );

  const signInOrEnableCloud = useCallback(
    async (...args: ConfirmEnableArgs) => {
      if (googleStatus !== 'connected') {
        openSignIn();
        return;
      }

      await enableCloud(...args);
    },
    [enableCloud, googleStatus, openSignIn]
  );

  const confirmEnableCloud = useCallback(
    (ws: Workspace, options?: ConfirmEnableCloudOptions) => {
      const { onSuccess, onFinished } = options ?? {};

      const closeOnSuccess = () => {
        closeConfirmModal();
        onSuccess?.();
      };

      openConfirmModal(
        {
          title: 'Back up this workspace to Google Drive?',
          description:
            'Nota will copy this local workspace to your Google Drive and keep it synced there. The Drive account and workspace remain under your control.',
          cancelText: t['com.affine.enableAffineCloudModal.button.cancel'](),
          confirmText:
            googleStatus === 'connected'
              ? 'Back up to Google Drive'
              : 'Connect Google and continue',
          confirmButtonOptions: {
            variant: 'primary',
            ['data-testid' as string]: 'confirm-google-drive-backup-button',
          },
          onConfirm: async () =>
            await signInOrEnableCloud(ws, {
              ...options,
              onSuccess: closeOnSuccess,
            }),
          onOpenChange: open => {
            if (!open) onFinished?.();
          },
        },
        {
          autoClose: false,
        }
      );
    },
    [closeConfirmModal, googleStatus, openConfirmModal, signInOrEnableCloud, t]
  );

  return confirmEnableCloud;
};
