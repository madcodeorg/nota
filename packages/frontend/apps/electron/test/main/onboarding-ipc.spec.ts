import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  openMainApp: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle, on: mocks.on },
}));
vi.mock('@nota/i18n', () => ({ I18n: { changeLanguage: vi.fn() } }));
vi.mock('../../src/main/calendar', () => ({ calendarHandlers: {} }));
vi.mock('../../src/main/clipboard', () => ({ clipboardHandlers: {} }));
vi.mock('../../src/main/config-storage', () => ({ configStorageHandlers: {} }));
vi.mock('../../src/main/find-in-page', () => ({ findInPageHandlers: {} }));
vi.mock('../../src/main/google-auth/handlers', () => ({
  googleAuthHandlers: {},
}));
vi.mock('../../src/main/recording', () => ({ recordingHandlers: {} }));
vi.mock('../../src/main/shared-storage', () => ({ sharedStorageHandlers: {} }));
vi.mock('../../src/main/updater', () => ({ updaterHandlers: {} }));
vi.mock('../../src/main/windows-manager/popup', () => ({ popupHandlers: {} }));
vi.mock('../../src/main/worker/handlers', () => ({ workerHandlers: {} }));
vi.mock('../../src/main/ui/handlers', () => ({
  uiHandlers: {
    handleOpenMainApp: mocks.openMainApp,
    openExternal: mocks.openExternal,
  },
}));
vi.mock('../../src/main/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn() },
  getLogFilePath: vi.fn(),
  revealLogFile: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

async function registeredHandler() {
  const { registerHandlers } = await import('../../src/main/handlers');
  const { NOTA_API_CHANNEL_NAME } = await import('../../src/shared/type');
  registerHandlers();
  expect(mocks.handle).toHaveBeenCalledOnce();
  expect(mocks.handle.mock.calls[0][0]).toBe(NOTA_API_CHANNEL_NAME);
  return mocks.handle.mock.calls[0][1] as (
    event: object,
    ...args: unknown[]
  ) => Promise<unknown>;
}

describe('onboarding IPC handoff', () => {
  test('the registered invoke wrapper propagates handoff failure to the renderer', async () => {
    const failure = new Error('Workspace renderer unavailable');
    mocks.openMainApp.mockRejectedValueOnce(failure);
    const invoke = await registeredHandler();
    const event = { sender: { id: 123 } };
    await expect(invoke(event, 'ui:handleOpenMainApp')).rejects.toBe(failure);
    expect(mocks.openMainApp).toHaveBeenCalledWith(event);
  });

  test('successful handoff keeps the existing void result', async () => {
    mocks.openMainApp.mockResolvedValueOnce(undefined);
    const invoke = await registeredHandler();
    await expect(invoke({}, 'ui:handleOpenMainApp')).resolves.toBeUndefined();
    expect(mocks.openMainApp).toHaveBeenCalledOnce();
  });

  test('unrelated handler failures retain their existing null result', async () => {
    mocks.openExternal.mockRejectedValueOnce(new Error('Browser unavailable'));
    const invoke = await registeredHandler();
    await expect(
      invoke({}, 'ui:openExternal', 'https://nnota.app')
    ).resolves.toBeNull();
    expect(mocks.openMainApp).not.toHaveBeenCalled();
  });
});
