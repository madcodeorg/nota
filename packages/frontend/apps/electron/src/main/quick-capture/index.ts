import { join } from 'node:path';

import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import { Subject } from 'rxjs';

import { popupViewUrl } from '../../shared/internal-origin';
import { isMacOS } from '../../shared/utils';
import { beforeAppQuit } from '../cleanup';
import { logger } from '../logger';
import {
  QuickCaptureStateKey,
  QuickCaptureStateSchema,
} from '../shared-state-schema';
import { globalStateStorage } from '../shared-storage/storage';
import type { MainEventRegister, NamespaceHandlers } from '../type';
import { buildWebPreferences } from '../web-preferences';
import { getMainWindow } from '../windows-manager';

const WINDOW_NAME = 'quick-capture';
const WIDTH = 560;
const HEIGHT = 196;
const MAX_CAPTURE_LENGTH = 20_000;

// Captures wait here until the main window's renderer writes them into the
// journal, so a note typed while the workspace is still loading is not lost.
const pending: string[] = [];
const captured$ = new Subject<void>();
const shown$ = new Subject<void>();

let quickCaptureWindow: BrowserWindow | null = null;
let windowReady: Promise<void> | null = null;
let appWasFocused = false;
let registeredShortcut: string | null = null;

function readSettings() {
  return QuickCaptureStateSchema.parse(
    globalStateStorage.get(QuickCaptureStateKey) ?? {}
  );
}

async function buildWindow() {
  const { getExposedMeta } = await import('../exposed');
  const browserWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: buildWebPreferences({
      transparent: true,
      spellcheck: true,
      preload: join(__dirname, './preload.js'),
      additionalArguments: [
        `--main-exposed-meta=` + JSON.stringify(getExposedMeta()),
        `--window-name=${WINDOW_NAME}`,
      ],
    }),
  });
  browserWindow.on('blur', () => {
    hideQuickCapture({ restoreFocus: false });
  });
  browserWindow.on('closed', () => {
    quickCaptureWindow = null;
    windowReady = null;
  });
  windowReady = new Promise(resolve => {
    browserWindow.webContents.once('did-finish-load', () => resolve());
  });
  browserWindow.loadURL(popupViewUrl).catch(err => logger.error(err));
  return browserWindow;
}

export async function showQuickCapture() {
  if (!quickCaptureWindow || quickCaptureWindow.isDestroyed()) {
    quickCaptureWindow = await buildWindow();
  }
  const browserWindow = quickCaptureWindow;
  await windowReady;
  if (browserWindow.isVisible()) {
    browserWindow.focus();
    return;
  }

  appWasFocused = BrowserWindow.getFocusedWindow() !== null;
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  );
  browserWindow.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * 0.22),
    width: WIDTH,
    height: HEIGHT,
  });
  browserWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  browserWindow.setAlwaysOnTop(true, 'floating');
  browserWindow.show();
  browserWindow.focus();
  shown$.next();
}

function hideQuickCapture({ restoreFocus }: { restoreFocus: boolean }) {
  const browserWindow = quickCaptureWindow;
  if (!browserWindow || browserWindow.isDestroyed()) return;
  if (!browserWindow.isVisible()) return;
  browserWindow.hide();
  // Hand focus back to the app the user was in instead of raising Nota.
  if (restoreFocus && isMacOS() && !appWasFocused) {
    app.hide();
  }
}

function applyShortcut() {
  const { enabled, shortcut } = readSettings();
  const next = enabled ? shortcut : null;
  if (next === registeredShortcut) return;
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }
  if (!next) return;
  try {
    const ok = globalShortcut.register(next, () => {
      showQuickCapture().catch(err =>
        logger.error('Failed to show quick capture:', err)
      );
    });
    if (ok) {
      registeredShortcut = next;
    } else {
      logger.warn('Quick capture shortcut is already in use:', next);
    }
  } catch (err) {
    logger.error('Invalid quick capture shortcut:', next, err);
  }
}

export function setupQuickCapture() {
  applyShortcut();
  const sub = globalStateStorage
    .watch(QuickCaptureStateKey)
    .subscribe(() => applyShortcut());
  beforeAppQuit(() => {
    sub.unsubscribe();
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
    quickCaptureWindow?.destroy();
  });
}

export const quickCaptureHandlers = {
  show: async () => {
    await showQuickCapture();
  },
  hide: async () => {
    hideQuickCapture({ restoreFocus: true });
  },
  submit: async (_, text: string) => {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim().slice(0, MAX_CAPTURE_LENGTH);
    if (!trimmed) return false;
    pending.push(trimmed);
    hideQuickCapture({ restoreFocus: true });
    // Make sure a renderer exists to receive the capture.
    await getMainWindow();
    captured$.next();
    return true;
  },
  takePending: async () => {
    return pending.splice(0);
  },
  requeue: async (_, texts: string[]) => {
    if (!Array.isArray(texts)) return;
    pending.unshift(
      ...texts.filter((text): text is string => typeof text === 'string')
    );
  },
  getShortcut: async () => {
    return registeredShortcut;
  },
} satisfies NamespaceHandlers;

export const quickCaptureEvents = {
  onCaptured: (fn: () => void) => {
    const sub = captured$.subscribe(fn);
    return () => sub.unsubscribe();
  },
  onShown: (fn: () => void) => {
    const sub = shown$.subscribe(fn);
    return () => sub.unsubscribe();
  },
} satisfies Record<string, MainEventRegister>;
