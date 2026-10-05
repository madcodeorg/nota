import { type DocMode } from '@blocksuite/affine/model';
import { InformationIcon, LinkIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@nota/component';
import { useSharingUrl } from '@nota/core/components/hooks/nota/use-share-url';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import { useCallback } from 'react';

import * as styles from './edgeless-block-header.css';

export const DocInfoButton = ({
  docId,
  trackFn,
  'data-testid': dataTestId,
}: {
  docId: string;
  trackFn?: () => void;
  'data-testid'?: string;
}) => {
  const t = useI18n();
  const workspaceDialogService = useService(WorkspaceDialogService);

  const onClick = useCallback(() => {
    trackFn?.();
    workspaceDialogService.open('doc-info', { docId });
  }, [docId, trackFn, workspaceDialogService]);

  return (
    <IconButton
      className={styles.button}
      size={styles.iconSize}
      tooltip={t['com.affine.page-properties.page-info.view']()}
      data-testid={dataTestId}
      onClick={onClick}
    >
      <InformationIcon />
    </IconButton>
  );
};

export const CopyLinkButton = ({
  pageId,
  blockId,
  mode,
  trackFn,
  'data-testid': dataTestId,
}: {
  pageId: string;
  blockId?: string;
  mode?: DocMode;
  trackFn?: () => void;
  'data-testid'?: string;
}) => {
  const t = useI18n();
  const workspace = useService(WorkspaceService).workspace;

  const { onClickCopyLink } = useSharingUrl({
    workspaceId: workspace.id,
    pageId,
  });

  const copyLink = useCallback(() => {
    trackFn?.();
    onClickCopyLink(mode, blockId ? [blockId] : undefined);
  }, [blockId, mode, onClickCopyLink, trackFn]);

  return (
    <IconButton
      className={styles.button}
      size={styles.iconSize}
      tooltip={t['com.affine.share-menu.copy']()}
      data-testid={dataTestId}
      onClick={copyLink}
    >
      <LinkIcon />
    </IconButton>
  );
};
