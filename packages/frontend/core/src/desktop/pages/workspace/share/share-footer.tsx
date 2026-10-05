import { ArrowRightBigIcon } from '@blocksuite/icons/rc';
import { NOTA_LINKS } from '@nota/core/utils/public-links';
import { useI18n } from '@nota/i18n';

import * as styles from './share-footer.css';

export const ShareFooter = () => {
  const t = useI18n();
  return (
    <div className={styles.footerContainer}>
      <div className={styles.footer}>
        <div className={styles.description}>
          {t['com.affine.share-page.footer.description']()}
        </div>
        <a
          className={styles.getStartLink}
          href={NOTA_LINKS.source}
          target="_blank"
          rel="noreferrer"
        >
          {t['com.affine.share-page.footer.get-started']()}
          <ArrowRightBigIcon fontSize={16} />
        </a>
      </div>
    </div>
  );
};
