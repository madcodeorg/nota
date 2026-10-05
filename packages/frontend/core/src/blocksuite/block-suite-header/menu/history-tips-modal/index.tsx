import { OverlayModal } from '@nota/component';
import { useEnableCloud } from '@nota/core/components/hooks/nota/use-enable-cloud';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import { useCallback } from 'react';

import TopSvg from './top-svg';

export const HistoryTipsModal = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  const t = useI18n();
  const currentWorkspace = useService(WorkspaceService).workspace;
  const confirmEnableCloud = useEnableCloud();

  const handleConfirm = useCallback(() => {
    setOpen(false);
    confirmEnableCloud(currentWorkspace);
  }, [confirmEnableCloud, currentWorkspace, setOpen]);

  return (
    <OverlayModal
      open={open}
      topImage={<TopSvg />}
      title={t['com.affine.history-vision.tips-modal.title']()}
      onOpenChange={setOpen}
      description={t['com.affine.history-vision.tips-modal.description']()}
      cancelText={t['com.affine.history-vision.tips-modal.cancel']()}
      confirmButtonOptions={{
        variant: 'primary',
      }}
      onConfirm={handleConfirm}
      confirmText={t['com.affine.history-vision.tips-modal.confirm']()}
    />
  );
};
