import type { Store } from '@blocksuite/affine/store';
import { useEnableCloud } from '@nota/core/components/hooks/nota/use-enable-cloud';
import { WorkspaceShareSettingService } from '@nota/core/modules/share-setting';
import {
  isUserOwnedWorkspaceFlavour,
  type Workspace,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback, useEffect } from 'react';

import { ShareMenu } from './share-menu';
export { CloudSvg } from './cloud-svg';
export { ShareMenuContent } from './share-menu';

type SharePageModalProps = {
  workspace: Workspace;
  page: Store;
};

export const SharePageButton = ({ workspace, page }: SharePageModalProps) => {
  const t = useI18n();
  const shareSetting = useService(WorkspaceShareSettingService).sharePreview;
  const enableSharing = useLiveData(shareSetting.enableSharing$);

  const confirmEnableCloud = useEnableCloud();
  const handleOpenShareModal = useCallback((open: boolean) => {
    if (open) {
      track.$.sharePanel.$.open();
    }
  }, []);

  useEffect(() => {
    if (isUserOwnedWorkspaceFlavour(workspace.meta.flavour)) {
      return;
    }
    shareSetting.revalidate();
  }, [shareSetting, workspace.meta.flavour]);

  const sharingDisabled = enableSharing === false;
  const disabledReason = sharingDisabled
    ? t['com.affine.share-menu.workspace-sharing.disabled.tooltip']()
    : undefined;

  return (
    <ShareMenu
      workspaceMetadata={workspace.meta}
      currentPage={page}
      onEnableAffineCloud={() =>
        confirmEnableCloud(workspace, {
          openPageId: page.id,
        })
      }
      onOpenShareModal={handleOpenShareModal}
      disabled={sharingDisabled}
      disabledReason={disabledReason}
    />
  );
};
