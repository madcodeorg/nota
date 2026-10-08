import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  windows: [] as Array<{
    options: Record<string, unknown>;
    show: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setBackgroundColor: ReturnType<typeof vi.fn>;
    emit: (event: string) => void;
    webContents: { setZoomFactor: ReturnType<typeof vi.fn> };
  }>,
  load: vi.fn(),
  patch: vi.fn(),
  initMain: vi.fn(),
  getMain: vi.fn(),
  waitForUI: vi.fn(),
  retryTab: vi.fn(),
  stage: { value: 'onboarding' },
  main: { show: vi.fn(), isDestroyed: vi.fn(), setOpacity: vi.fn() },
  workArea: { x: 1440, y: 25, width: 1200, height: 840 },
  cursor: { x: 1900, y: 400 },
  nearestDisplay: vi.fn(),
}));

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => mocks.cursor,
    getDisplayNearestPoint: mocks.nearestDisplay,
  },
  BrowserWindow: class {
    listeners = new Map<string, () => void>();
    destroyed = false;
    show = vi.fn();
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.emit('closed');
    });
    setBackgroundColor = vi.fn();
    webContents = {
      setZoomFactor: vi.fn(),
      openDevTools: vi.fn(),
    };
    constructor(public options: Record<string, unknown>) {
      mocks.windows.push(this);
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, listener);
    }
    emit(event: string) {
      this.listeners.get(event)?.();
    }
    isDestroyed() {
      return this.destroyed;
    }
    async loadURL(url: string) {
      await mocks.load(url);
      this.emit('ready-to-show');
    }
  },
}));
vi.mock('../../src/main/config', () => ({ isDev: false }));
vi.mock('../../src/main/constants', () => ({
  onboardingViewUrl: 'assets://./onboarding',
}));
vi.mock('../../src/main/exposed', () => ({
  getExposedMeta: () => ({ handlers: [], events: [] }),
}));
vi.mock('../../src/main/config-storage/persist', () => ({
  persistentConfig: { patch: mocks.patch },
}));
vi.mock('../../src/main/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/main/windows-manager/stage', () => ({
  launchStage: mocks.stage,
}));
vi.mock('../../src/main/windows-manager/main-window', () => ({
  initAndShowMainWindow: mocks.initMain,
  getMainWindow: mocks.getMain,
}));
vi.mock('../../src/main/windows-manager/tab-views', () => ({
  waitForActiveTabUI: mocks.waitForUI,
  retryUnreadyActiveTab: mocks.retryTab,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.windows.length = 0;
  mocks.stage.value = 'onboarding';
  mocks.nearestDisplay.mockReturnValue({ workArea: mocks.workArea });
  mocks.load.mockResolvedValue(undefined);
  mocks.initMain.mockResolvedValue(mocks.main);
  mocks.getMain.mockResolvedValue(mocks.main);
  mocks.main.isDestroyed.mockReturnValue(false);
  mocks.waitForUI.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('native first-launch presentation', () => {
  test('opens a transparent desktop overlay on macOS', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const { launch } = await import('../../src/main/windows-manager/launcher');
    await launch();
    expect(mocks.nearestDisplay).toHaveBeenCalledWith(mocks.cursor);
    expect(mocks.windows[0].options).toMatchObject({
      ...mocks.workArea,
      frame: false,
      transparent: true,
      show: false,
      closable: true,
      fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    expect(mocks.load).toHaveBeenCalledWith('assets://./onboarding');
    expect(mocks.windows[0].show).toHaveBeenCalledOnce();
    expect(mocks.windows[0].webContents.setZoomFactor).toHaveBeenCalledWith(1);
    expect(mocks.initMain).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  test('uses an opaque themed surface on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const { launch } = await import('../../src/main/windows-manager/launcher');
    await launch();

    expect(mocks.windows[0].options).toMatchObject({
      ...mocks.workArea,
      frame: true,
      transparent: false,
      backgroundColor: '#efeee7',
      closable: true,
      titleBarStyle: 'default',
    });

    // The fallback must stay opaque after focus transitions; Electron can
    // otherwise reintroduce a black/undefined transparent surface on Windows.
    mocks.windows[0].emit('focus');
    mocks.windows[0].emit('blur');
    expect(mocks.windows[0].setBackgroundColor).toHaveBeenNthCalledWith(
      1,
      '#efeee7'
    );
    expect(mocks.windows[0].setBackgroundColor).toHaveBeenNthCalledWith(
      2,
      '#efeee7'
    );
  });

  test('uses the same framed opaque fallback on Linux', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const { launch } = await import('../../src/main/windows-manager/launcher');
    await launch();

    expect(mocks.windows[0].options).toMatchObject({
      frame: true,
      transparent: false,
      backgroundColor: '#efeee7',
      closable: true,
      titleBarStyle: 'default',
    });
  });

  test('returning users launch directly into the existing main window', async () => {
    mocks.stage.value = 'main';
    const { launch } = await import('../../src/main/windows-manager/launcher');
    await launch();
    expect(mocks.initMain).toHaveBeenCalledOnce();
    expect(mocks.windows).toHaveLength(0);
  });

  test('reuses the onboarding window on app activation', async () => {
    const { launch } = await import('../../src/main/windows-manager/launcher');
    await launch();
    await launch();
    expect(mocks.windows).toHaveLength(1);
    expect(mocks.windows[0].show).toHaveBeenCalledTimes(2);
  });

  test('a failed renderer load cleans up without recording completion or poisoning launch', async () => {
    const { launch } = await import('../../src/main/windows-manager/launcher');
    mocks.load.mockRejectedValueOnce(new Error('Renderer unavailable'));
    await expect(launch()).resolves.toBeUndefined();
    expect(mocks.windows[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.stage.value).toBe('onboarding');
    expect(mocks.patch).not.toHaveBeenCalled();
    await launch();
    expect(mocks.windows).toHaveLength(2);
    expect(mocks.windows[1].show).toHaveBeenCalledOnce();
  });
});

describe('onboarding handoff', () => {
  test('completes only after the main renderer is interactive', async () => {
    const { getOrCreateOnboardingWindow, openMainAppFromOnboarding } =
      await import('../../src/main/windows-manager/onboarding');
    await getOrCreateOnboardingWindow();
    let ready!: () => void;
    mocks.waitForUI.mockImplementation(
      () => new Promise<void>(resolve => (ready = resolve))
    );
    const opening = openMainAppFromOnboarding();
    await vi.waitFor(() => expect(mocks.waitForUI).toHaveBeenCalledOnce());
    expect(mocks.stage.value).toBe('onboarding');
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.windows[0].destroy).not.toHaveBeenCalled();
    ready();
    await opening;
    expect(mocks.main.show).toHaveBeenCalledOnce();
    // The workspace stays transparent while loading, then fades in fully.
    expect(mocks.main.setOpacity).toHaveBeenNthCalledWith(1, 0);
    expect(mocks.main.setOpacity).toHaveBeenLastCalledWith(1);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith('onBoarding', false);
    expect(mocks.stage.value).toBe('main');
    expect(mocks.windows[0].destroy).toHaveBeenCalledOnce();
  });

  test.each(['window', 'renderer'])(
    'a %s failure preserves first launch and restores onboarding for retry',
    async failure => {
      const { getOrCreateOnboardingWindow, openMainAppFromOnboarding } =
        await import('../../src/main/windows-manager/onboarding');
      await getOrCreateOnboardingWindow();
      const operation = failure === 'window' ? mocks.initMain : mocks.waitForUI;
      operation.mockRejectedValueOnce(new Error('Open failed'));
      await expect(openMainAppFromOnboarding()).rejects.toThrow('Open failed');
      expect(mocks.stage.value).toBe('onboarding');
      expect(mocks.patch).not.toHaveBeenCalled();
      expect(mocks.windows[0].destroy).not.toHaveBeenCalled();
      expect(mocks.windows[0].show).toHaveBeenCalledOnce();
      await openMainAppFromOnboarding();
      expect(mocks.retryTab).toHaveBeenCalledOnce();
      expect(mocks.stage.value).toBe('main');
      expect(mocks.windows[0].destroy).toHaveBeenCalledOnce();
    }
  );

  test('concurrent entry actions share one handoff and create no duplicate windows', async () => {
    const { getOrCreateOnboardingWindow, openMainAppFromOnboarding } =
      await import('../../src/main/windows-manager/onboarding');
    await getOrCreateOnboardingWindow();
    const first = openMainAppFromOnboarding();
    const second = openMainAppFromOnboarding();
    expect(first).toBe(second);
    await first;
    expect(mocks.initMain).toHaveBeenCalledOnce();
    expect(mocks.patch).toHaveBeenCalledOnce();
    expect(mocks.windows).toHaveLength(1);
  });

  test('normal entry without an onboarding window does not wait for onboarding UI', async () => {
    mocks.stage.value = 'main';
    const { openMainAppFromOnboarding } =
      await import('../../src/main/windows-manager/onboarding');
    await openMainAppFromOnboarding();
    expect(mocks.waitForUI).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.main.show).toHaveBeenCalledOnce();
    expect(mocks.main.setOpacity).not.toHaveBeenCalled();
  });

  test('a closed main window does not complete first launch', async () => {
    const { getOrCreateOnboardingWindow, openMainAppFromOnboarding } =
      await import('../../src/main/windows-manager/onboarding');
    await getOrCreateOnboardingWindow();
    mocks.main.isDestroyed.mockReturnValueOnce(true);
    await expect(openMainAppFromOnboarding()).rejects.toThrow(
      'Workspace window closed.'
    );
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.stage.value).toBe('onboarding');
    expect(mocks.windows[0].destroy).not.toHaveBeenCalled();
  });
});
