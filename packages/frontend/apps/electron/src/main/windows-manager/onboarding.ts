import { join } from 'node:path';

import { BrowserWindow, screen } from 'electron';

import { isDev } from '../config';
import { persistentConfig } from '../config-storage/persist';
import { onboardingViewUrl } from '../constants';
import { logger } from '../logger';
import { buildWebPreferences } from '../web-preferences';
import { getMainWindow, initAndShowMainWindow } from './main-window';
import { launchStage } from './stage';
import { retryUnreadyActiveTab, waitForActiveTabUI } from './tab-views';

// todo: not all window need all of the exposed meta
const getWindowAdditionalArguments = async () => {
  const { getExposedMeta } = await import('../exposed');
  const mainExposedMeta = getExposedMeta();
  return [
    `--main-exposed-meta=` + JSON.stringify(mainExposedMeta),
    `--window-name=onboarding`,
  ];
};

async function createOnboardingWindow(additionalArguments: string[]) {
  logger.info('creating onboarding window');

  // Chromium can render the transparent desktop overlay reliably on macOS.
  // Other platforms use an opaque, themed, framed surface so the wizard has
  // a visible native close control instead of an invisible frameless window.
  const supportsDesktopOverlay = process.platform === 'darwin';

  // A normal transparent window overlays the desktop without entering a Space
  // or covering the system menu bar and Dock.
  const { x, y, width, height } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea;

  const browserWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    backgroundColor: supportsDesktopOverlay ? '#00000000' : '#efeee7',
    frame: !supportsDesktopOverlay,
    show: false,
    resizable: false,
    closable: true,
    minimizable: false,
    movable: false,
    titleBarStyle: supportsDesktopOverlay ? 'hidden' : 'default',
    maximizable: false,
    fullscreenable: false,
    transparent: supportsDesktopOverlay,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: buildWebPreferences({
      webgl: true,
      preload: join(__dirname, './preload.js'),
      additionalArguments: additionalArguments,
    }),
  });

  // workaround for the phantom title bar on windows when losing focus
  // see https://github.com/electron/electron/issues/39959#issuecomment-1758736966
  browserWindow.on('focus', () => {
    browserWindow.setBackgroundColor(
      supportsDesktopOverlay ? '#00000000' : '#efeee7'
    );
  });

  browserWindow.on('blur', () => {
    browserWindow.setBackgroundColor(
      supportsDesktopOverlay ? '#00000000' : '#efeee7'
    );
  });

  browserWindow.on('ready-to-show', () => {
    // forcing zoom factor to 1 to avoid onboarding display issues
    browserWindow.webContents.setZoomFactor(1);
  });

  if (isDev) {
    browserWindow.webContents.openDevTools();
  }

  try {
    await browserWindow.loadURL(onboardingViewUrl);
  } catch (error) {
    browserWindow.destroy();
    throw error;
  }

  return browserWindow;
}

let onBoardingWindow: Promise<BrowserWindow> | undefined;

export async function getOrCreateOnboardingWindow() {
  if (
    !onBoardingWindow ||
    (await onBoardingWindow.then(w => w.isDestroyed()))
  ) {
    onBoardingWindow = getWindowAdditionalArguments()
      .then(createOnboardingWindow)
      .catch(error => {
        onBoardingWindow = undefined;
        throw error;
      });
  }

  return onBoardingWindow;
}

export async function getOnboardingWindow() {
  if (!onBoardingWindow) return;
  const window = await onBoardingWindow;
  if (window.isDestroyed()) return;
  return window;
}

let openingMainApp: Promise<void> | undefined;
let retryMainView = false;
const MAIN_FADE_MS = 380;

/** Eases the workspace window in over the first-launch overlay. */
function fadeIn(window: BrowserWindow) {
  return new Promise<void>(resolve => {
    const start = Date.now();
    const tick = () => {
      if (window.isDestroyed()) return resolve();
      const progress = Math.min(1, (Date.now() - start) / MAIN_FADE_MS);
      window.setOpacity(1 - (1 - progress) ** 3);
      if (progress >= 1) resolve();
      else setTimeout(tick, 16);
    };
    tick();
  });
}

/** Keep first launch resumable until an interactive main view exists. */
export function openMainAppFromOnboarding() {
  if (openingMainApp) return openingMainApp;
  openingMainApp = (async () => {
    const onboarding = await getOnboardingWindow();
    let main: BrowserWindow | undefined;
    try {
      if (onboarding) {
        // Keep the loading workspace invisible over the welcome overlay.
        main = await getMainWindow();
        main.setOpacity(0);
      }
      main = await initAndShowMainWindow();
      if (onboarding) {
        if (retryMainView) await retryUnreadyActiveTab();
        await waitForActiveTabUI();
      }
      if (main.isDestroyed()) throw new Error('Workspace window closed.');
      main.show();
      if (onboarding) await fadeIn(main);
      if (launchStage.value === 'onboarding') {
        persistentConfig.patch('onBoarding', false);
        launchStage.value = 'main';
      }
      onboarding?.destroy();
      retryMainView = false;
    } catch (error) {
      retryMainView = true;
      if (main && !main.isDestroyed()) main.setOpacity(1);
      if (onboarding && !onboarding.isDestroyed()) onboarding.show();
      logger.error('handleOpenMainApp', error);
      throw error;
    }
  })().finally(() => {
    openingMainApp = undefined;
  });
  return openingMainApp;
}
