import { DownloadIcon, ResetIcon } from '@blocksuite/icons/rc';
import { useAppUpdater } from '@nota/core/components/hooks/use-app-updater';
import { Suspense } from 'react';

import * as styles from './header-update-button.css';

const UpdateButton = () => {
  const {
    updateAvailable,
    updateReady,
    downloadProgress,
    downloadUpdate,
    quitAndInstall,
    appQuitting,
  } = useAppUpdater();

  if (updateReady) {
    return (
      <button
        type="button"
        className={styles.button}
        data-ready
        data-testid="header-update-button"
        title={`Nota ${updateReady.version} is ready to install`}
        disabled={appQuitting}
        onClick={quitAndInstall}
      >
        <ResetIcon className={styles.icon} />
        {appQuitting ? 'Restarting...' : 'Restart to update'}
      </button>
    );
  }

  if (!updateAvailable) return null;

  // Progress starts at 0 before any download, so only count real progress.
  if (downloadProgress !== null && downloadProgress > 0) {
    return (
      <button
        type="button"
        className={styles.button}
        data-testid="header-update-button"
        disabled
      >
        <span className={styles.progress} aria-hidden>
          <span
            className={styles.progressFill}
            style={{ width: `${downloadProgress}%` }}
          />
        </span>
        Downloading {Math.round(downloadProgress)}%
      </button>
    );
  }

  return (
    <button
      type="button"
      className={styles.button}
      data-testid="header-update-button"
      title={`Download Nota ${updateAvailable.version}`}
      onClick={downloadUpdate}
    >
      <DownloadIcon className={styles.icon} />
      Update to {updateAvailable.version}
    </button>
  );
};

/** Shows in the top header once the updater finds a new version. */
export const HeaderUpdateButton = () => {
  if (!BUILD_CONFIG.isElectron) return null;
  // The updater reads the current version asynchronously; never let that
  // suspend the whole header.
  return (
    <Suspense fallback={null}>
      <UpdateButton />
    </Suspense>
  );
};
