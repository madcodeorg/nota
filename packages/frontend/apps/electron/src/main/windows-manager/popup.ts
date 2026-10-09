import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  powerMonitor,
} from 'electron';
import { BehaviorSubject } from 'rxjs';

import { beforeAppQuit } from '../cleanup';
import { popupViewUrl } from '../constants';
import { GOOGLE_SESSION_PUBLIC_STATE_KEY } from '../google-auth/secure-session';
import { logger } from '../logger';
import {
  MeetingSettingsKey,
  MeetingSettingsSchema,
} from '../shared-state-schema';
import {
  globalCacheStorage,
  globalStateStorage,
} from '../shared-storage/storage';
import type { MainEventRegister, NamespaceHandlers } from '../type';
import { buildWebPreferences } from '../web-preferences';
import {
  decideMeetingCalendarTrigger,
  effectiveMeetingRecordingMode,
  type MeetingTriggerHistory,
  pruneMeetingTriggerHistory,
} from './meeting-popup-scheduler';
import {
  BACKGROUND_CALENDAR_SELECTION_KEY,
  getMeetingPopupState,
  invalidateMeetingPopupCalendarCache,
  joinMeetingFromPopup,
  type MeetingPopupState,
  openMeetingPopupPage,
  startAndJoinMeetingFromPopup,
  startMeetingFromPopup,
  stopMeetingFromPopup,
} from './meeting-popup-state';
import { getCurrentDisplay } from './utils';

type PopupWindowType = 'meeting' | 'notification' | 'recording';

async function getAdditionalArguments(name: string) {
  const { getExposedMeta } = await import('../exposed');
  const mainExposedMeta = getExposedMeta();
  return [
    `--main-exposed-meta=` + JSON.stringify(mainExposedMeta),
    `--window-name=${name}`,
  ];
}

const POPUP_PADDING = 20; // padding between the popup and the edge of the screen
const MEETING_SIZE = [380, 56];
const NOTIFICATION_SIZE = [300, 128];
const RECORDING_SIZE = [380, 56];
const MEETING_TRIGGER_HISTORY_KEY = 'meeting:calendar-trigger-history:v1';
const MEETING_TRIGGER_POLL_MS = 15 * 1000;
const MEETING_START_CONFIRM_TIMEOUT_MS = 30 * 1000;
const MEETING_START_CONFIRM_POLL_MS = 250;

async function animate(
  current: number,
  target: number,
  setter: (val: number) => void,
  duration = 200,
  delay = 0
): Promise<void> {
  const fps = 60;
  const steps = duration / (1000 / fps);
  const delta = target - current;
  const easing = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

  if (delay > 0) {
    await setTimeout(delay);
  }

  for (let i = 0; i < steps; i++) {
    const progress = easing(i / steps);
    setter(current + delta * progress);
    await setTimeout(1000 / fps);
  }

  // Ensure we hit the target exactly
  setter(target);
}

abstract class PopupWindow {
  abstract readonly type: PopupWindowType;
  abstract readonly name: string;
  browserWindow: BrowserWindow | undefined;

  abstract windowOptions: Partial<BrowserWindowConstructorOptions>;

  ready = Promise.withResolvers<void>();

  private readonly showing$ = new BehaviorSubject<boolean>(false);

  get showing() {
    return this.showing$.value;
  }

  async build(): Promise<BrowserWindow> {
    const browserWindow = new BrowserWindow({
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: false,
      alwaysOnTop: true,
      hiddenInMissionControl: true,
      skipTaskbar: true,
      movable: false,
      titleBarStyle: 'hidden',
      show: false, // hide by default,
      backgroundColor: 'transparent',
      visualEffectState: 'active',
      vibrancy: 'under-window',
      ...this.windowOptions,
      webPreferences: buildWebPreferences({
        webgl: true,
        transparent: true,
        spellcheck: false,
        disableHtmlFullscreenWindowResize: true,
        preload: join(__dirname, './preload.js'), // this points to the bundled preload module
        ...this.windowOptions.webPreferences,
        // serialize exposed meta that to be used in preload
        additionalArguments: await getAdditionalArguments(this.name),
      }),
    });

    // it seems that the dock will disappear when popup windows are shown
    await app.dock?.show();

    // required to make the window transparent
    browserWindow.setBackgroundColor('#00000000');
    this.showOnAllSpaces(browserWindow);
    this.lockWindowSize(browserWindow);

    logger.info('loading popup', this.name, popupViewUrl);
    browserWindow.webContents.on('did-finish-load', () => {
      this.ready.resolve();
      logger.info('popup ready', this.name);
    });
    browserWindow.on('will-resize', event => {
      event.preventDefault();
      this.lockWindowSize(browserWindow);
    });
    browserWindow.on('maximize', () => {
      browserWindow.unmaximize();
      this.lockWindowSize(browserWindow);
    });
    browserWindow.on('enter-full-screen', () => {
      browserWindow.setFullScreen(false);
      this.lockWindowSize(browserWindow);
    });
    browserWindow.webContents.on('enter-html-full-screen', () => {
      browserWindow.webContents
        .executeJavaScript('document.exitFullscreen?.()', true)
        .catch(error => logger.warn('failed to exit popup fullscreen', error));
      this.lockWindowSize(browserWindow);
    });
    browserWindow.loadURL(popupViewUrl).catch(err => logger.error(err));
    return browserWindow;
  }

  // Keep the pill above every app, including full-screen apps and other Spaces.
  private showOnAllSpaces(browserWindow: BrowserWindow) {
    browserWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true, // keeps the Dock icon from disappearing
    });
    browserWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  }

  private get windowSize(): [number, number] {
    const width =
      typeof this.windowOptions.width === 'number'
        ? this.windowOptions.width
        : 300;
    const height =
      typeof this.windowOptions.height === 'number'
        ? this.windowOptions.height
        : 42;
    return [width, height];
  }

  private lockWindowSize(browserWindow: BrowserWindow) {
    const [width, height] = this.windowSize;
    browserWindow.setMinimumSize(width, height);
    browserWindow.setMaximumSize(width, height);
    browserWindow.setSize(width, height);
  }

  async show() {
    if (!this.browserWindow) {
      this.browserWindow = await this.build();
    }
    const browserWindow = this.browserWindow;
    this.lockWindowSize(browserWindow);
    const workArea = getCurrentDisplay(browserWindow).workArea;
    const popupSize = this.windowSize;

    await this.ready.promise;

    this.showing$.next(true);

    this.showOnAllSpaces(browserWindow);
    browserWindow.showInactive(); // focus the notification is too distracting right?
    browserWindow.moveTop();
    browserWindow.setOpacity(0);

    // Calculate start and end positions for x coordinate
    const startX = workArea.x + workArea.width + popupSize[0] + POPUP_PADDING;
    const endX = workArea.x + workArea.width - popupSize[0] - POPUP_PADDING;
    const y = workArea.y + POPUP_PADDING;

    // Set initial position
    browserWindow.setPosition(startX, y);

    logger.info('showing popup', this.name);

    // First fade in, then slide
    await Promise.all([
      // Slide in animation
      animate(
        startX,
        endX,
        x => {
          browserWindow.setPosition(Math.round(x), y);
        },
        300
      ),
      // Fade in animation
      animate(
        0,
        1,
        opacity => {
          this.browserWindow?.setOpacity(opacity);
        },
        100,
        100
      ),
    ]);
  }

  async hide() {
    if (!this.browserWindow) {
      return;
    }
    logger.info('hiding popup', this.name);
    this.showing$.next(false);
    await animate(this.browserWindow.getOpacity(), 0, opacity => {
      this.browserWindow?.setOpacity(opacity);
    });
    this.browserWindow?.hide();
  }

  destroy() {
    this.browserWindow?.destroy();
  }
}

// leave for future use
type ElectronNotification = null;

class NotificationPopupWindow extends PopupWindow {
  readonly type = 'notification' as const;
  readonly name = `${this.type}`;

  notification$ = new BehaviorSubject<ElectronNotification | null>(null);

  windowOptions: Partial<BrowserWindowConstructorOptions> = {
    width: NOTIFICATION_SIZE[0],
    height: NOTIFICATION_SIZE[1],
  };

  async notify(notification: ElectronNotification) {
    this.notification$.next(notification);
    await super.show();
  }
}

class MeetingPopupWindow extends PopupWindow {
  readonly type = 'meeting' as const;
  readonly name = `${this.type}`;
  windowOptions: Partial<BrowserWindowConstructorOptions> = {
    width: MEETING_SIZE[0],
    height: MEETING_SIZE[1],
    movable: true,
  };
}

// recording popup window is singleton across the app
class RecordingPopupWindow extends PopupWindow {
  readonly type = 'recording' as const;
  readonly name = `${this.type}`;
  windowOptions: Partial<BrowserWindowConstructorOptions> = {
    width: RECORDING_SIZE[0],
    height: RECORDING_SIZE[1],
    movable: true,
  };
}

// Type mapping from PopupWindowType to specific window class
type PopupWindowTypeMap = {
  meeting: MeetingPopupWindow;
  notification: NotificationPopupWindow;
  recording: RecordingPopupWindow;
};

export class PopupManager {
  static readonly instance = new PopupManager();
  // there could be a single instance of each type of popup window
  readonly popupWindows$ = new BehaviorSubject<Map<string, PopupWindow>>(
    new Map()
  );

  get<T extends PopupWindowType>(type: T): PopupWindowTypeMap[T] {
    // Check if popup of this type already exists
    const existingPopup = Array.from(this.popupWindows$.value.values()).find(
      popup => popup.type === type
    ) as PopupWindowTypeMap[T] | undefined;

    // If exists, return it
    if (existingPopup) {
      return existingPopup;
    }

    // Otherwise create a new one
    const popupWindow = (() => {
      switch (type) {
        case 'meeting':
          return new MeetingPopupWindow() as PopupWindowTypeMap[T];
        case 'notification':
          return new NotificationPopupWindow() as PopupWindowTypeMap[T];
        case 'recording':
          return new RecordingPopupWindow() as PopupWindowTypeMap[T];
        default:
          throw new Error(`Unknown popup type: ${type}`);
      }
    })();

    this.popupWindows$.next(
      new Map(this.popupWindows$.value).set(popupWindow.type, popupWindow)
    );
    return popupWindow;
  }
}

export const popupManager = PopupManager.instance;

let meetingPopupSchedulerCleanup: (() => void) | undefined;
let meetingPopupCleanupRegistered = false;

function readMeetingTriggerHistory(now: number): MeetingTriggerHistory {
  const stored = globalCacheStorage.get<unknown>(MEETING_TRIGGER_HISTORY_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }

  const history = Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, number] => {
      return typeof entry[1] === 'number';
    })
  );
  return pruneMeetingTriggerHistory(history, now);
}

function persistMeetingTriggerDecision(key: string, handledAt: number) {
  globalCacheStorage.set(MEETING_TRIGGER_HISTORY_KEY, {
    ...readMeetingTriggerHistory(handledAt),
    [key]: handledAt,
  });
}

async function waitForMeetingRecordingStart() {
  const deadline = Date.now() + MEETING_START_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await getMeetingPopupState();
    if (state.recording.status !== 'idle') {
      return true;
    }
    await setTimeout(MEETING_START_CONFIRM_POLL_MS);
  }
  return false;
}

export function setupMeetingPopup() {
  meetingPopupSchedulerCleanup?.();

  let currentCheck: Promise<void> | null = null;
  let rerunRequested = false;
  let restoreActivePopup = true;
  let schedulerGeneration = 0;
  let disposed = false;
  let pendingAutoStartKey: string | null = null;

  const checkMeetingCalendar = async () => {
    const generation = schedulerGeneration;
    const initialSettings = MeetingSettingsSchema.parse(
      globalStateStorage.get(MeetingSettingsKey) ?? {}
    );
    let state: MeetingPopupState | undefined;

    // Preserve the existing launch behavior for an interrupted active meeting,
    // even when calendar-triggered recording is disabled.
    if (restoreActivePopup) {
      state = await getMeetingPopupState();
      restoreActivePopup = false;
      if (state.recording.status !== 'idle') {
        if (pendingAutoStartKey) {
          persistMeetingTriggerDecision(pendingAutoStartKey, Date.now());
          pendingAutoStartKey = null;
        }
        await popupManager.get('meeting').show();
        return;
      }
    }

    if (initialSettings.recordingMode === 'none') {
      return;
    }

    state ??= await getMeetingPopupState();
    if (state.recording.status !== 'idle' && pendingAutoStartKey) {
      persistMeetingTriggerDecision(pendingAutoStartKey, Date.now());
      pendingAutoStartKey = null;
    }
    if (disposed || generation !== schedulerGeneration) {
      return;
    }

    // Re-read settings after calendar I/O so a user disabling auto-start while
    // a refresh is in flight always wins before any recording action.
    const settings = MeetingSettingsSchema.parse(
      globalStateStorage.get(MeetingSettingsKey) ?? {}
    );
    if (settings.recordingMode === 'none') {
      return;
    }
    const now = Date.now();
    const handled = readMeetingTriggerHistory(now);
    const mode = effectiveMeetingRecordingMode(
      settings.recordingMode,
      !state.upcoming || state.upcoming.selectionKnown
    );
    const decision = decideMeetingCalendarTrigger({
      handled,
      mode,
      now,
      recordingStatus: state.recording.status,
      upcoming: state.upcoming,
    });
    if (!decision) {
      return;
    }

    if (decision.action === 'auto-start') {
      pendingAutoStartKey = decision.key;
      await startMeetingFromPopup();
      await popupManager.get('meeting').show();
      if (await waitForMeetingRecordingStart()) {
        persistMeetingTriggerDecision(decision.key, Date.now());
        pendingAutoStartKey = null;
      } else {
        logger.warn(
          'Calendar auto-start did not reach recording state; it remains retryable',
          { eventId: state.upcoming?.id }
        );
      }
    } else {
      await popupManager.get('meeting').show();
      persistMeetingTriggerDecision(decision.key, now);
    }

    logger.info('Triggered calendar meeting flow', {
      action: decision.action,
      eventId: state.upcoming?.id,
    });
  };

  const runCheck = () => {
    if (currentCheck) {
      rerunRequested = true;
      return;
    }
    currentCheck = checkMeetingCalendar()
      .catch(error =>
        logger.error('Failed to run meeting calendar scheduler', error)
      )
      .finally(() => {
        currentCheck = null;
        if (rerunRequested && !disposed) {
          rerunRequested = false;
          queueMicrotask(runCheck);
        }
      });
  };

  const invalidateAndRunCheck = () => {
    schedulerGeneration += 1;
    invalidateMeetingPopupCalendarCache();
    runCheck();
  };

  const initialTimer = globalThis.setTimeout(runCheck, 1200);
  const pollTimer = globalThis.setInterval(runCheck, MEETING_TRIGGER_POLL_MS);
  const onResume = () => invalidateAndRunCheck();
  const onActivate = () => invalidateAndRunCheck();
  powerMonitor.on('resume', onResume);
  app.on('activate', onActivate);
  const settingsSubscription = globalStateStorage
    .watch(MeetingSettingsKey)
    .subscribe(() => invalidateAndRunCheck());
  const googleSessionSubscription = globalStateStorage
    .watch(GOOGLE_SESSION_PUBLIC_STATE_KEY)
    .subscribe(() => invalidateAndRunCheck());
  const calendarSelectionSubscription = globalStateStorage
    .watch(BACKGROUND_CALENDAR_SELECTION_KEY)
    .subscribe(() => invalidateAndRunCheck());

  const cleanup = () => {
    disposed = true;
    schedulerGeneration += 1;
    globalThis.clearTimeout(initialTimer);
    globalThis.clearInterval(pollTimer);
    powerMonitor.off('resume', onResume);
    app.off('activate', onActivate);
    settingsSubscription.unsubscribe();
    googleSessionSubscription.unsubscribe();
    calendarSelectionSubscription.unsubscribe();
    if (meetingPopupSchedulerCleanup === cleanup) {
      meetingPopupSchedulerCleanup = undefined;
    }
  };
  meetingPopupSchedulerCleanup = cleanup;
  if (!meetingPopupCleanupRegistered) {
    beforeAppQuit(() => meetingPopupSchedulerCleanup?.());
    meetingPopupCleanupRegistered = true;
  }
}

// recording popup window events/handlers are in ../recording/index.ts
export const popupHandlers = {
  getCurrentNotification: async () => {
    const notification = popupManager.get('notification').notification$.value;
    if (!notification) {
      return null;
    }
    return notification;
  },
  dismissCurrentNotification: async () => {
    return popupManager.get('notification').hide();
  },
  dismissCurrentRecording: async () => {
    return popupManager.get('recording').hide();
  },
  getMeetingPopupState: async () => {
    return getMeetingPopupState();
  },
  showMeetingPopup: async () => {
    return popupManager.get('meeting').show();
  },
  dismissMeetingPopup: async () => {
    return popupManager.get('meeting').hide();
  },
  openMeetingPopupPage: async () => {
    return openMeetingPopupPage();
  },
  startMeetingFromPopup: async () => {
    return startMeetingFromPopup();
  },
  stopMeetingFromPopup: async () => {
    return stopMeetingFromPopup();
  },
  joinMeetingFromPopup: async (_, url: string) => {
    return joinMeetingFromPopup(url);
  },
  startAndJoinMeetingFromPopup: async (_, url: string) => {
    return startAndJoinMeetingFromPopup(url);
  },
} satisfies NamespaceHandlers;

export const popupEvents = {
  onNotificationChanged: (
    callback: (notification: ElectronNotification | null) => void
  ) => {
    const notification = popupManager.get('notification');
    const sub = notification.notification$.subscribe(notification => {
      callback(notification);
    });
    return () => {
      sub.unsubscribe();
    };
  },
} satisfies Record<string, MainEventRegister>;
