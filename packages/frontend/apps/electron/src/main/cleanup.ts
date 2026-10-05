import type { MediaStats } from '@nota/infra';
import { app } from 'electron';

import { logger } from './logger';
import { globalStateStorage } from './shared-storage/storage';

const beforeAppQuitRegistry: Array<() => void | Promise<void>> = [];
const beforeTabCloseRegistry: ((tabId: string) => void)[] = [];
let didExitAfterWillQuit = false;
let appQuitCleanupComplete = false;
let appQuitCleanupPromise: Promise<void> | null = null;

export function beforeAppQuit(fn: () => void | Promise<void>) {
  beforeAppQuitRegistry.push(fn);
}

export function beforeTabClose(fn: (tabId: string) => void) {
  beforeTabCloseRegistry.push(fn);
}

app.on('before-quit', event => {
  if (appQuitCleanupComplete) {
    return;
  }

  event.preventDefault();
  appQuitCleanupPromise ??= (async () => {
    // Run in registration order so upstream cleanup that returns a promise can
    // finish before downstream processes are asked to exit.
    for (const fn of beforeAppQuitRegistry) {
      try {
        await fn();
      } catch (err) {
        logger.warn('cleanup error on quit', err);
      }
    }
    appQuitCleanupComplete = true;
    app.quit();
  })();
});

app.on('will-quit', () => {
  if (process.platform !== 'darwin' || didExitAfterWillQuit) {
    return;
  }

  didExitAfterWillQuit = true;
  // Native media/sqlite bindings can crash during V8 teardown after normal
  // macOS quit. By this point before-quit cleanup has already run.
  const reallyExit = (
    process as typeof process & { reallyExit?: (code?: number) => never }
  ).reallyExit;
  if (typeof reallyExit === 'function') {
    reallyExit(0);
  }
  process.kill(process.pid, 'SIGTERM');
});

export function onTabClose(tabId: string) {
  beforeTabCloseRegistry.forEach(fn => {
    try {
      fn(tabId);
    } catch (err) {
      logger.warn('cleanup error on tab close', err);
    }
  });
}

app.on('ready', () => {
  globalStateStorage.set('media:playback-state', null);
  globalStateStorage.set('media:stats', null);
});

beforeAppQuit(() => {
  globalStateStorage.set('media:playback-state', null);
  globalStateStorage.set('media:stats', null);
});

// set audio play state
beforeTabClose(tabId => {
  const stats = globalStateStorage.get<MediaStats | null>('media:stats');
  if (stats && stats.tabId === tabId) {
    globalStateStorage.set('media:playback-state', null);
    globalStateStorage.set('media:stats', null);
  }
});
