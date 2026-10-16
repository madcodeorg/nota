import { Button } from '@nota/component';
import { Modal } from '@nota/component/ui/modal';
import { UrlService } from '@nota/core/modules/url';
import { useService } from '@nota/infra';
import { useEffect, useState } from 'react';

import { getWelcomeState } from '../../pages/onboarding/setup-state';
import * as styles from './index.css';

const SEEN_KEY = 'nota-whats-new:seen-version';

function readSeenVersion() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markWhatsNewSeen() {
  try {
    localStorage.setItem(SEEN_KEY, BUILD_CONFIG.appVersion);
  } catch {
    // The box may show again next launch; that is harmless.
  }
}

/**
 * True once per version, after an update, and records the version right away
 * so other tabs do not show it again. A fresh install only records its version
 * so new users are not shown notes for a release they never upgraded from.
 */
export function shouldShowWhatsNew() {
  if (!BUILD_CONFIG.isElectron || !BUILD_CONFIG.releaseNotes.length) {
    return false;
  }
  const seen = readSeenVersion();
  if (seen === BUILD_CONFIG.appVersion) return false;
  if (seen === null) {
    markWhatsNewSeen();
    return false;
  }
  // Wait until the setup wizard is closed; the notes show on a later open.
  if (getWelcomeState().showSetup === true) return false;
  markWhatsNewSeen();
  return true;
}

export function WhatsNewModal() {
  const urlService = useService(UrlService);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(shouldShowWhatsNew()), []);

  const close = () => setOpen(false);

  return (
    <Modal
      open={open}
      onOpenChange={next => {
        if (!next) close();
      }}
      width={460}
      contentOptions={{ 'aria-label': "What's new in Nota" }}
    >
      <div className={styles.eyebrow}>
        Updated to version {BUILD_CONFIG.appVersion}
      </div>
      <h2 className={styles.title}>What&rsquo;s new in Nota</h2>
      <ul className={styles.list}>
        {BUILD_CONFIG.releaseNotes.map(note => (
          <li key={note} className={styles.item}>
            {note}
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <Button
          variant="plain"
          onClick={() =>
            urlService.openPopupWindow(
              `${BUILD_CONFIG.githubUrl}/releases/tag/v${BUILD_CONFIG.appVersion}`
            )
          }
        >
          Full release notes
        </Button>
        <Button variant="primary" onClick={close} data-testid="whats-new-done">
          Got it
        </Button>
      </div>
    </Modal>
  );
}
