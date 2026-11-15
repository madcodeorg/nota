import { CloseIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@nota/component/ui/button';
import { useI18n } from '@nota/i18n';

import * as styles from './index.css';

type LocalDemoTipsProps = {
  onClose: () => void;
};

/** Web-only notice that browser storage can be cleared. Nota is local-first,
 * so it points to the desktop app and backups rather than a cloud account. */
export const LocalDemoTips = ({ onClose }: LocalDemoTipsProps) => {
  const t = useI18n();

  return (
    <div className={styles.tipsContainer} data-testid="local-demo-tips">
      <div className={styles.tipsMessage}>
        {t['com.affine.banner.local-warning']()}
      </div>

      <div className={styles.tipsRightItem}>
        <IconButton
          onClick={onClose}
          size="20"
          data-testid="local-demo-tips-close-button"
        >
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  );
};

export default LocalDemoTips;
