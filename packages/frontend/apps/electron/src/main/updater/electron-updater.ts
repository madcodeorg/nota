import { app, shell } from 'electron';
import {
  autoUpdater as defaultAutoUpdater,
  DebUpdater,
} from 'electron-updater';

import { buildType } from '../config';
import { logger } from '../logger';
import { canInstallUpdate } from './capabilities';
import { updaterSubjects } from './event';
import { WindowsUpdater } from './windows-updater';

const isDev = process.env.NODE_ENV === 'development';
export const UPDATE_FEED_BASE = 'https://thenota.app/updates';
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const updateFeedEnabled =
  process.env.NOTA_ENABLE_AUTO_UPDATE === '1' ||
  (app.isPackaged && process.env.NOTA_DISABLE_AUTO_UPDATE !== '1');

export function getUpdateFeedUrl(
  channel: string,
  override = process.env.NOTA_UPDATE_FEED_URL
) {
  return override || `${UPDATE_FEED_BASE}/${channel}`;
}

const disabled = isDev || !updateFeedEnabled;
const allowAutoUpdate = canInstallUpdate();
// DebUpdater inherits ordinary packaged-app checking, unlike AppImageUpdater
// which refuses checks without APPIMAGE. Deliberately CHECK-ONLY for all other
// Linux formats: its privileged install path must never be invoked here.
export const autoUpdater =
  process.platform === 'win32'
    ? new WindowsUpdater()
    : process.platform === 'linux' && !allowAutoUpdate
      ? new DebUpdater()
      : defaultAutoUpdater;

// Safe defaults before the renderer can call any updater IPC.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowDowngrade = false;

let downloading = false;
let registered = false;
let checkingUpdate = false;
let lastCheckTime = 0;
let availableVersion: string | undefined;
let readyToInstall = false;

export type UpdaterConfig = {
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
};
const config: UpdaterConfig = {
  autoCheckUpdate: updateFeedEnabled,
  autoDownloadUpdate: false,
};
export const getConfig = (): UpdaterConfig => ({ ...config });
export const setConfig = (newConfig: Partial<UpdaterConfig> = {}): void => {
  // Old saved preferences cannot turn off normal packaged release checks.
  Object.assign(config, newConfig, { autoCheckUpdate: updateFeedEnabled });
};

export const checkForUpdates = async () => {
  if (disabled || !registered || checkingUpdate) return null;
  checkingUpdate = true;
  lastCheckTime = Date.now();
  try {
    return await autoUpdater.checkForUpdates();
  } finally {
    checkingUpdate = false;
  }
};

export const downloadUpdate = async (userInitiated = true) => {
  if (disabled || !registered || !availableVersion || downloading) return;
  if (!allowAutoUpdate || !canInstallUpdate()) {
    updaterSubjects.updateAvailable$.next({
      version: availableVersion,
      allowAutoUpdate: false,
    });
    if (!userInitiated) return;
    // No elevation or installation-format migration behind a Download button.
    await shell.openExternal(
      process.windowsStore
        ? 'ms-windows-store://downloadsandupdates'
        : `https://github.com/madcodeorg/nota/releases/tag/v${availableVersion}`
    );
    return;
  }
  downloading = true;
  readyToInstall = false;
  updaterSubjects.downloadProgress$.next(0);
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    downloading = false;
    updaterSubjects.downloadProgress$.next(0);
    throw error;
  }
};

export const quitAndInstall = async () => {
  if (disabled || !registered || !allowAutoUpdate || !readyToInstall) return;
  if (!canInstallUpdate()) {
    readyToInstall = false;
    updaterSubjects.updateReady$.next(null);
    if (availableVersion)
      updaterSubjects.updateAvailable$.next({
        version: availableVersion,
        allowAutoUpdate: false,
      });
    return;
  }
  autoUpdater.quitAndInstall();
};

function automaticallyCheck() {
  if (!config.autoCheckUpdate) return;
  void checkForUpdates().catch(error =>
    logger.error('Error checking for updates', error)
  );
}

export const registerUpdater = async () => {
  if (disabled || registered) return;
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = buildType === 'beta';
  autoUpdater.allowDowngrade = false;
  // Keep the default "latest" filenames inside separate beta/stable folders.
  // Setting updater.channel='beta' would request nonexistent beta-linux.yml.
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: getUpdateFeedUrl(buildType),
  });
  autoUpdater.on('update-available', info => {
    availableVersion = info.version;
    const canInstall = allowAutoUpdate && canInstallUpdate();
    updaterSubjects.updateAvailable$.next({
      version: info.version,
      allowAutoUpdate: canInstall,
    });
    if (config.autoDownloadUpdate && canInstall) {
      void downloadUpdate(false).catch(error =>
        logger.error('Failed to download update', error)
      );
    }
  });
  autoUpdater.on('update-not-available', () => {
    availableVersion = undefined;
    readyToInstall = false;
    updaterSubjects.updateAvailable$.next(null);
    updaterSubjects.updateReady$.next(null);
  });
  autoUpdater.on('download-progress', event =>
    updaterSubjects.downloadProgress$.next(event.percent)
  );
  autoUpdater.on('update-downloaded', event => {
    downloading = false;
    if (!allowAutoUpdate || event.version !== availableVersion) return;
    if (!canInstallUpdate()) {
      updaterSubjects.updateAvailable$.next({
        version: event.version,
        allowAutoUpdate: false,
      });
      return;
    }
    readyToInstall = true;
    downloading = false;
    updaterSubjects.updateReady$.next({
      version: event.version,
      allowAutoUpdate,
    });
  });
  autoUpdater.on('error', error => {
    downloading = false;
    updaterSubjects.downloadProgress$.next(0);
    logger.error('Error while updating client', error);
  });
  registered = true;
  app.on('browser-window-focus', () => {
    if (lastCheckTime + UPDATE_CHECK_INTERVAL_MS <= Date.now())
      automaticallyCheck();
  });
  const timer = setInterval(automaticallyCheck, UPDATE_CHECK_INTERVAL_MS);
  timer.unref();
  app.once('will-quit', () => clearInterval(timer));
  // Network checks must not delay startup, recording setup or opening notes.
  automaticallyCheck();
};
