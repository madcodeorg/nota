import { InformationIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@nota/component';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback } from 'react';

export const InfoButton = ({ docId }: { docId: string }) => {
  const workspaceDialogService = useService(WorkspaceDialogService);
  const t = useI18n();

  const onOpenInfoModal = useCallback(() => {
    track.$.header.actions.openDocInfo();
    workspaceDialogService.open('doc-info', { docId });
  }, [docId, workspaceDialogService]);

  return (
    <IconButton
      size="20"
      tooltip={t['com.affine.page-properties.page-info.view']()}
      data-testid="header-info-button"
      onClick={onOpenInfoModal}
    >
      <InformationIcon />
    </IconButton>
  );
};
