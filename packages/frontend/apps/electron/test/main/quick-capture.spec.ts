import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMainWindow: vi.fn(async () => ({})),
}));

vi.mock('electron', () => ({
  app: { hide: vi.fn() },
  BrowserWindow: class {
    static getFocusedWindow() {
      return null;
    }
  },
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  screen: {},
}));
vi.mock('../../src/main/cleanup', () => ({ beforeAppQuit: vi.fn() }));
vi.mock('../../src/main/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../../src/main/shared-storage/storage', () => ({
  globalStateStorage: { get: vi.fn(), watch: vi.fn() },
}));
vi.mock('../../src/main/windows-manager', () => ({
  getMainWindow: mocks.getMainWindow,
}));
vi.mock('../../src/shared/internal-origin', () => ({ popupViewUrl: '' }));

beforeEach(() => {
  vi.resetModules();
});

const event = {} as Electron.IpcMainInvokeEvent;

describe('quick capture queue', () => {
  test('keeps submitted notes until the renderer takes them', async () => {
    const { quickCaptureHandlers, quickCaptureEvents } =
      await import('../../src/main/quick-capture');
    const onCaptured = vi.fn();
    const unsubscribe = quickCaptureEvents.onCaptured(onCaptured);

    expect(await quickCaptureHandlers.submit(event, '  first  ')).toBe(true);
    expect(await quickCaptureHandlers.submit(event, 'second')).toBe(true);
    expect(onCaptured).toHaveBeenCalledTimes(2);
    expect(mocks.getMainWindow).toHaveBeenCalled();

    expect(await quickCaptureHandlers.takePending(event)).toEqual([
      'first',
      'second',
    ]);
    expect(await quickCaptureHandlers.takePending(event)).toEqual([]);
    unsubscribe();
  });

  test('ignores empty notes and puts failed writes back in order', async () => {
    const { quickCaptureHandlers } =
      await import('../../src/main/quick-capture');
    expect(await quickCaptureHandlers.submit(event, '   ')).toBe(false);

    await quickCaptureHandlers.submit(event, 'later');
    await quickCaptureHandlers.requeue(event, ['failed one', 'failed two']);
    expect(await quickCaptureHandlers.takePending(event)).toEqual([
      'failed one',
      'failed two',
      'later',
    ]);
  });
});
