import { EventEmitter } from 'node:events';

import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/nota'),
    getPath: vi.fn(() => '/tmp/nota-user-data'),
    isPackaged: false,
  },
  utilityProcess: { fork: vi.fn() },
}));

vi.mock('../../src/main/cleanup', () => ({
  beforeAppQuit: vi.fn(),
}));

vi.mock('../../src/main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { requestAiBackendShutdown } from '../../src/main/ai-backend';

describe('AI backend shutdown', () => {
  test('waits for the backend to finish its delayed meeting tail before exiting', async () => {
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn(),
      pid: 1234,
      postMessage: vi.fn(),
    });

    let stopped = false;
    const stop = requestAiBackendShutdown(
      child as unknown as Electron.UtilityProcess,
      1_000
    ).then(() => {
      stopped = true;
    });

    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'nota-ai-backend-shutdown',
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    child.emit('exit', 0);
    await stop;
    expect(stopped).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
