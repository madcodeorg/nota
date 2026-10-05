import { LocalWorkspaceIcon } from '@blocksuite/icons/rc';
import { NotaLogoIcon } from '@nota/component/auth-components';
import { Button } from '@nota/component/ui/button';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { appIconMap, appNames } from '@nota/core/utils/channel';
import { NOTA_LINKS } from '@nota/core/utils/public-links';
import { Trans, useI18n } from '@nota/i18n';
import { useServiceOptional } from '@nota/infra';
import type { MouseEvent } from 'react';
import { useCallback } from 'react';

import { getOpenUrlInDesktopAppLink } from '../utils';
import * as styles from './open-in-app-page.css';

let lastOpened = '';

interface OpenAppProps {
  urlToOpen?: string | null;
  openHereClicked?: (e: MouseEvent) => void;
  mode?: 'auth' | 'open-doc'; // default to 'auth'
}
const channel = BUILD_CONFIG.appBuildType;
const url = NOTA_LINKS.downloads;

export const OpenInAppPage = ({
  urlToOpen,
  openHereClicked,
  mode = 'auth',
}: OpenAppProps) => {
  // default to open the current page in desktop app
  urlToOpen ??= getOpenUrlInDesktopAppLink(window.location.href, true);
  const workspaceDialogService = useServiceOptional(WorkspaceDialogService);
  const t = useI18n();

  const openDownloadLink = useCallback(() => {
    open(url, '_blank');
  }, []);

  const appIcon = appIconMap[channel];
  const appName = appNames[channel];

  const goToAppearanceSetting = useCallback(
    (e: MouseEvent) => {
      openHereClicked?.(e);
      workspaceDialogService?.open('setting', {
        activeTab: 'appearance',
      });
    },
    [workspaceDialogService, openHereClicked]
  );

  if (urlToOpen && lastOpened !== urlToOpen) {
    lastOpened = urlToOpen;
    location.href = urlToOpen;
  }

  if (!urlToOpen) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.topNav}>
        <a href="/" rel="noreferrer" className={styles.notaLogo}>
          <NotaLogoIcon width={24} height={24} />
        </a>

        <div className={styles.topNavLinks}>
          <a
            href={NOTA_LINKS.source}
            target="_blank"
            rel="noreferrer"
            className={styles.topNavLink}
          >
            Project on GitHub
          </a>
          <a
            href={NOTA_LINKS.docs}
            target="_blank"
            rel="noreferrer"
            className={styles.topNavLink}
          >
            Documentation
          </a>
          <a
            href={NOTA_LINKS.issues}
            target="_blank"
            rel="noreferrer"
            className={styles.topNavLink}
          >
            Report an issue
          </a>
        </div>

        <Button onClick={openDownloadLink}>
          {t['com.affine.auth.open.affine.download-app']()}
        </Button>
      </div>

      <div className={styles.centerContent}>
        <img src={appIcon} alt={appName} width={120} height={120} />

        <div className={styles.prompt}>
          {mode === 'open-doc' ? (
            <Trans i18nKey="com.affine.auth.open.affine.open-doc-prompt">
              This doc is now opened in {appName}
            </Trans>
          ) : (
            <Trans i18nKey="com.affine.auth.open.nota.prompt">
              Open {appName} app now
            </Trans>
          )}
        </div>

        <div className={styles.promptLinks}>
          {openHereClicked && (
            <a
              className={styles.promptLink}
              onClick={openHereClicked}
              target="_blank"
              rel="noreferrer"
            >
              {t['com.affine.auth.open.affine.doc.open-here']()}
            </a>
          )}
          <a
            className={styles.promptLink}
            href={urlToOpen}
            target="_blank"
            rel="noreferrer"
          >
            {t['com.affine.auth.open.affine.try-again']()}
          </a>
        </div>
      </div>

      {mode === 'open-doc' ? (
        <div className={styles.docFooter}>
          <button
            className={styles.editSettingsLink}
            onClick={goToAppearanceSetting}
          >
            {t['com.affine.auth.open.affine.doc.edit-settings']()}
          </button>

          <div className={styles.docFooterText}>
            <LocalWorkspaceIcon width={16} height={16} />
            {t['com.affine.auth.open.affine.doc.footer-text']()}
          </div>
        </div>
      ) : null}
    </div>
  );
};
