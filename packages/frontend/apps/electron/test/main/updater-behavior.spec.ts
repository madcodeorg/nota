import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instances: [] as any[],
  available: true,
  canInstall: false,
  buildType: 'beta',
  openExternal: vi.fn(async () => {}),
  handlers: new Map<string, () => void>(),
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/cache',
    on: (name: string, callback: () => void) =>
      mocks.handlers.set(name, callback),
    once: (name: string, callback: () => void) =>
      mocks.handlers.set(name, callback),
  },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock('../../src/main/config', () => ({
  get buildType() {
    return mocks.buildType;
  },
}));
vi.mock('../../src/main/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../src/main/updater/capabilities', () => ({
  canInstallUpdate: () => mocks.canInstall,
}));
vi.mock('electron-updater/out/DownloadedUpdateHelper', () => ({
  DownloadedUpdateHelper: class {},
}));
vi.mock('electron-updater', () => {
  class Updater {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    listeners = new Map<string, (value: any) => void>();
    setFeedURL = vi.fn();
    downloadUpdate = vi.fn(async () => []);
    quitAndInstall = vi.fn();
    checkForUpdates = vi.fn(async () => {
      const updateInfo = { version: '0.1.14-beta.2' };
      this.fire(
        mocks.available ? 'update-available' : 'update-not-available',
        updateInfo
      );
      return { updateInfo, isUpdateAvailable: mocks.available };
    });
    constructor(public kind: string) {
      mocks.instances.push(this);
    }
    on(name: string, callback: (value: any) => void) {
      this.listeners.set(name, callback);
    }
    fire(name: string, value: any) {
      this.listeners.get(name)?.(value);
    }
  }
  return {
    get autoUpdater() {
      return new Updater('default');
    },
    DebUpdater: class extends Updater {
      constructor() {
        super('deb');
      }
    },
    NsisUpdater: class extends Updater {
      constructor() {
        super('windows');
      }
    },
  };
});

async function load(platform: NodeJS.Platform = 'linux') {
  vi.stubGlobal('process', {
    ...process,
    platform,
    windowsStore: false,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NOTA_DISABLE_AUTO_UPDATE: undefined,
      NOTA_UPDATE_FEED_URL: undefined,
    },
  });
  const module = await import('../../src/main/updater/electron-updater');
  const events = await import('../../src/main/updater/event');
  return {
    module,
    subjects: events.updaterSubjects,
    updater: mocks.instances.at(-1),
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T00:00:00Z'));
  mocks.instances = [];
  mocks.available = true;
  mocks.canInstall = false;
  mocks.buildType = 'beta';
  mocks.handlers.clear();
  mocks.openExternal.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('update checking and safe installation capabilities', () => {
  it('guards checks until registration and sets safe flags before renderer IPC', async () => {
    const { module, updater } = await load();
    module.setConfig({ autoCheckUpdate: false, autoDownloadUpdate: false });
    expect(module.getConfig().autoCheckUpdate).toBe(true);
    expect(await module.checkForUpdates()).toBeNull();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await module.registerUpdater();
    await settle();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://thenota.app/updates/beta',
    });
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.channel).toBeUndefined();
  });

  it('checks Debian/ZIP without allowing SDK download, installation or automatic browser opening', async () => {
    const { module, updater, subjects } = await load();
    const available = vi.fn();
    subjects.updateAvailable$.subscribe(available);
    const ready = vi.fn();
    subjects.updateReady$.subscribe(ready);
    module.setConfig({ autoDownloadUpdate: true });
    await module.registerUpdater();
    await settle();
    expect(updater.kind).toBe('deb');
    expect(available).toHaveBeenCalledWith({
      version: '0.1.14-beta.2',
      allowAutoUpdate: false,
    });
    expect(mocks.openExternal).not.toHaveBeenCalled();
    updater.fire('update-downloaded', { version: '0.1.14-beta.2' });
    expect(ready).not.toHaveBeenCalled();
    await module.quitAndInstall();
    await module.downloadUpdate();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://github.com/madcodeorg/nota/releases/tag/v0.1.14-beta.2'
    );
  });

  it('checks periodically without focus, throttles focus, and cleans up on quit', async () => {
    const { module, updater } = await load();
    await module.registerUpdater();
    await settle();
    mocks.handlers.get('browser-window-focus')!();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(module.UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    mocks.handlers.get('will-quit')!();
    await vi.advanceTimersByTimeAsync(module.UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('preserves a successful negative result separately from a check that did not run', async () => {
    mocks.available = false;
    const { module } = await load();
    expect(await module.checkForUpdates()).toBeNull();
    await module.registerUpdater();
    await settle();
    const api = await import('../../src/main/updater');
    expect(await api.updaterHandlers.checkForUpdates()).toEqual({
      version: '0.1.14-beta.2',
      isUpdateAvailable: false,
    });
  });

  it.each(['linux', 'win32', 'darwin'] as const)(
    'native %s requires a completed download and explicit restart',
    async platform => {
      mocks.canInstall = true;
      const { module, updater } = await load(platform);
      await module.registerUpdater();
      await settle();
      await module.quitAndInstall();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      await module.downloadUpdate();
      expect(updater.downloadUpdate).toHaveBeenCalledOnce();
      updater.fire('update-downloaded', { version: '0.1.14-beta.2' });
      await module.quitAndInstall();
      expect(updater.quitAndInstall).toHaveBeenCalledOnce();
      expect(updater.autoInstallOnAppQuit).toBe(false);
    }
  );

  it('withdrawn updates clear controls for existing and newly subscribed windows', async () => {
    const { module, subjects, updater } = await load();
    const observed = vi.fn();
    subjects.updateAvailable$.subscribe(observed);
    await module.registerUpdater();
    await settle();
    expect(observed).toHaveBeenLastCalledWith({
      version: '0.1.14-beta.2',
      allowAutoUpdate: false,
    });
    mocks.available = false;
    await module.checkForUpdates();
    expect(observed).toHaveBeenLastCalledWith(null);
    const later = vi.fn();
    subjects.updateAvailable$.subscribe(later);
    expect(later).toHaveBeenLastCalledWith(null);
    await module.downloadUpdate();
    expect(mocks.openExternal).not.toHaveBeenCalled();
    updater.fire('update-downloaded', { version: '0.1.14-beta.2' });
    await module.quitAndInstall();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('rechecks installation permission rather than trusting the startup snapshot', async () => {
    mocks.canInstall = true;
    const { module, updater, subjects } = await load();
    const ready = vi.fn();
    subjects.updateReady$.subscribe(ready);
    await module.registerUpdater();
    await settle();
    updater.fire('update-downloaded', { version: '0.1.14-beta.2' });
    mocks.canInstall = false;
    await module.quitAndInstall();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(ready).toHaveBeenLastCalledWith(null);
  });

  it('manual checks do not postpone the fixed periodic check', async () => {
    const { module, updater } = await load();
    await module.registerUpdater();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    await module.checkForUpdates();
    await vi.advanceTimersByTimeAsync(module.UPDATE_CHECK_INTERVAL_MS - 60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('stable uses only its stable directory and never permits downgrades', async () => {
    mocks.buildType = 'stable';
    const { module, updater } = await load('win32');
    await module.registerUpdater();
    await settle();
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://thenota.app/updates/stable',
    });
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
  });
});
