import { OverlayModal } from '@nota/component';
import { useI18n } from '@nota/i18n';

export const StarNotaModal = ({
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
      title={t['com.affine.star-affine.title']()}
      onOpenChange={setOpen}
      description={
        <>
          <p>{t['com.affine.star-affine.description']()}</p>
          <ol>
            <li>Open the Nota repository on GitHub.</li>
            <li>Sign in to your GitHub account.</li>
            <li>Select Star near the top of the repository page.</li>
          </ol>
        </>
      }
      cancelText={t['com.affine.star-affine.cancel']()}
      to={BUILD_CONFIG.githubUrl}
      confirmButtonOptions={{
        variant: 'primary',
      }}
      confirmText={t['com.affine.star-affine.confirm']()}
      external
    />
  );
};
