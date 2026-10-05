import { OverlayModal } from '@nota/component';
import { useI18n } from '@nota/i18n';

export const IssueFeedbackModal = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  const t = useI18n();

  return (
    <OverlayModal
      open={open}
      title={t['com.affine.issue-feedback.title']()}
      onOpenChange={setOpen}
      description={
        <>
          <p>{t['com.affine.issue-feedback.description']()}</p>
          <ol>
            <li>Open the Nota issue form on GitHub.</li>
            <li>Choose the issue type and describe what happened.</li>
            <li>Include your Nota version and steps to reproduce the issue.</li>
          </ol>
        </>
      }
      cancelText={t['com.affine.issue-feedback.cancel']()}
      to={`${BUILD_CONFIG.githubUrl}/issues/new/choose`}
      confirmText={t['com.affine.issue-feedback.confirm']()}
      confirmButtonOptions={{
        variant: 'primary',
      }}
      external
    />
  );
};
