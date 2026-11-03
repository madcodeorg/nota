import { Trans, useI18n } from '@nota/i18n';
import clsx from 'clsx';
import { useCallback } from 'react';

import { Button } from '../../ui/button';
import { Loading } from '../../ui/loading';
import { Skeleton } from '../../ui/skeleton';
import { ThemedImg } from '../../ui/themed-img';
import imageUrlForDarkLoading from './assets/loading.dark.png';
import imageUrlForLightLoading from './assets/loading.light.png';
import * as styles from './index.css';

export const EditorLoading = ({
  longerLoading = false,
}: {
  longerLoading?: boolean;
}) => {
  const t = useI18n();
  const reloadPage = useCallback(() => {
    document.location.reload();
  }, []);
  return (
    <div className={styles.blockSuiteEditorStyle}>
      <ThemedImg
        style={{ width: '300px' }}
        draggable={false}
        className={styles.illustration}
        lightSrc={imageUrlForLightLoading}
        darkSrc={imageUrlForDarkLoading}
      />
      {longerLoading ? (
        <div className={styles.content} data-longer-loading={true}>
          <div>
            <div className={styles.text} data-longer-loading={true}>
              {t['com.affine.error.loading-timeout-error']()}
            </div>
            <div className={styles.text} data-longer-loading={true}>
              <Trans
                i18nKey="com.affine.error.contact-us"
                components={{
                  1: (
                    <a
                      style={{ color: 'var(--affine-primary-color)' }}
                      href="https://github.com/madcodeorg/nota/issues"
                      target="__blank"
                    />
                  ),
                }}
              />
            </div>
          </div>
          <Button
            size="large"
            className={clsx(
              BUILD_CONFIG.isMobileEdition
                ? styles.mobileActionButton
                : styles.actionButton
            )}
            contentClassName={clsx(
              BUILD_CONFIG.isMobileEdition
                ? styles.mobileActionContent
                : styles.actionContent
            )}
            onClick={reloadPage}
            variant="primary"
          >
            {t['com.affine.error.reload']()}
          </Button>
        </div>
      ) : (
        <div className={styles.content}>
          <div className={styles.title}>
            <Loading size={20} className={styles.loadingIcon} />
            {t['com.affine.loading']()}
          </div>
          <div className={styles.text}>
            {t['com.affine.loading.description']()}
          </div>
        </div>
      )}
    </div>
  );
};

const DOC_PARAGRAPHS = [
  ['92%', '86%', '95%', '64%'],
  ['90%', '78%', '45%'],
];

export const PageDetailLoading = () => {
  return (
    <div className={styles.pageDetailSkeletonStyle} aria-busy="true">
      <div className={styles.docSkeleton}>
        <Skeleton variant="text" animation="wave" width="55%" height={36} />
        <Skeleton variant="text" animation="wave" width={140} height={14} />
        {DOC_PARAGRAPHS.map(lines => (
          <div key={lines.join()} className={styles.docSkeletonParagraph}>
            {lines.map(width => (
              <Skeleton
                key={width}
                variant="text"
                animation="wave"
                width={width}
                height={14}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
