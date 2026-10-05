import { describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (event?: unknown) => void>(),
  quit: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn((event: string, handler: (event?: unknown) => void) => {
      electronMocks.handlers.set(event, handler);
    }),
    quit: electronMocks.quit,
  },
}));

vi.mock('../../src/main/logger', () => ({
  logger: { warn: vi.fn() },
}));

vi.mock('../../src/main/shared-storage/storage', () => ({
  globalStateStorage: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { beforeAppQuit } from '../../src/main/cleanup';

describe('main-process cleanup', () => {
  test('holds Electron quit until asynchronous cleanup completes', async () => {
    let releaseCleanup: (() => void) | undefined;
    beforeAppQuit(
      () =>
        new Promise<void>(resolve => {
          releaseCleanup = resolve;
        })
    );
    const backendShutdown = vi.fn();
    beforeAppQuit(backendShutdown);

    const preventDefault = vi.fn();
    electronMocks.handlers.get('before-quit')?.({ preventDefault });
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electronMocks.quit).not.toHaveBeenCalled();
    expect(backendShutdown).not.toHaveBeenCalled();

    releaseCleanup?.();
    await vi.waitFor(() => expect(electronMocks.quit).toHaveBeenCalledOnce());
    expect(backendShutdown).toHaveBeenCalledOnce();
  });
});
