import { of } from 'rxjs';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureHelper: vi.fn(),
  connectMain: vi.fn(),
  windows: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
}));
vi.mock('electron', () => ({
  nativeTheme: {},
  BrowserWindow: class {
    destroyed = false;
    destroy = vi.fn(() => (this.destroyed = true));
    constructor() {
      mocks.windows.push(this);
    }
    on() {}
    isDestroyed() {
      return this.destroyed;
    }
  },
}));
vi.mock('electron-window-state', () => ({
  default: () => ({ width: 1000, height: 800, manage: vi.fn() }),
}));
vi.mock('../../src/shared/utils', () => ({
  isMacOS: () => false,
  isWindows: () => false,
  isLinux: () => false,
  resourcesPath: '/tmp/nota-test',
}));
vi.mock('../../src/main/cleanup', () => ({ beforeAppQuit: vi.fn() }));
vi.mock('../../src/main/config', () => ({ buildType: 'stable' }));
vi.mock('../../src/main/constants', () => ({
  mainWindowOrigin: 'assets://.',
}));
vi.mock('../../src/main/helper-process', () => ({
  ensureHelperProcess: mocks.ensureHelper,
}));
vi.mock('../../src/main/logger', () => ({
  logger: { info: vi.fn() },
}));
vi.mock('../../src/main/shared-state-schema', () => ({
  MenubarStateKey: 'menubar',
  MenubarStateSchema: { parse: () => ({ enabled: false }) },
}));
vi.mock('../../src/main/shared-storage/storage', () => ({
  globalStateStorage: { watch: () => of({}), get: () => ({}) },
}));
vi.mock('../../src/main/ui/subject', () => ({ uiSubjects: {} }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.windows.length = 0;
  mocks.ensureHelper.mockResolvedValue({ connectMain: mocks.connectMain });
});

test('a failed helper startup closes its empty main window and can retry', async () => {
  const { MainWindowManager } =
    await import('../../src/main/windows-manager/main-window');
  const manager = new MainWindowManager();
  mocks.ensureHelper.mockRejectedValueOnce(new Error('Helper unavailable'));
  await expect(manager.ensureMainWindow()).rejects.toThrow(
    'Helper unavailable'
  );
  expect(mocks.windows[0].destroy).toHaveBeenCalledOnce();
  expect(manager.mainWindowReady).toBeUndefined();
  expect(manager.mainWindow).toBeUndefined();
  const recovered = await manager.ensureMainWindow();
  expect(recovered).toBe(mocks.windows[1]);
  expect(manager.mainWindow).toBe(recovered);
  expect(await manager.ensureMainWindow()).toBe(recovered);
  expect(mocks.windows).toHaveLength(2);
});

test('a failed helper binding also leaves no cached failed window', async () => {
  const { MainWindowManager } =
    await import('../../src/main/windows-manager/main-window');
  const manager = new MainWindowManager();
  mocks.connectMain.mockImplementationOnce(() => {
    throw new Error('Bridge unavailable');
  });
  await expect(manager.ensureMainWindow()).rejects.toThrow(
    'Bridge unavailable'
  );
  expect(mocks.windows[0].destroy).toHaveBeenCalledOnce();
  expect(manager.mainWindowReady).toBeUndefined();
  await expect(manager.ensureMainWindow()).resolves.toBe(mocks.windows[1]);
});
