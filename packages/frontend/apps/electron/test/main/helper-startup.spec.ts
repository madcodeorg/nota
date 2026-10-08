import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fork: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {},
  dialog: {},
  shell: {},
  utilityProcess: { fork: mocks.fork },
}));
vi.mock('../../src/main/cleanup', () => ({ beforeAppQuit: vi.fn() }));
vi.mock('../../src/main/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/main/security/open-external', () => ({
  openExternalSafely: vi.fn(),
}));
vi.mock('../../src/main/shared-storage/storage', () => ({
  globalStateStorage: { get: vi.fn(), set: vi.fn() },
}));

function child() {
  return Object.assign(new EventEmitter(), {
    pid: 1234,
    kill: vi.fn(),
    postMessage: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

describe('workspace helper startup events', () => {
  test('concurrent callers share the spawned helper', async () => {
    const helperProcess = child();
    mocks.fork.mockReturnValue(helperProcess);
    const { ensureHelperProcess } =
      await import('../../src/main/helper-process');
    const first = ensureHelperProcess();
    const second = ensureHelperProcess();
    expect(mocks.fork).toHaveBeenCalledOnce();
    helperProcess.emit('spawn');
    const helper = await first;
    expect(await second).toBe(helper);
    expect(await ensureHelperProcess()).toBe(helper);
    expect(mocks.fork).toHaveBeenCalledOnce();
  });

  test('an error before spawn rejects all waiting callers and permits a fresh fork', async () => {
    const failed = child();
    const recovered = child();
    mocks.fork.mockReturnValueOnce(failed).mockReturnValueOnce(recovered);
    const { ensureHelperProcess } =
      await import('../../src/main/helper-process');
    const first = expect(ensureHelperProcess()).rejects.toThrow('FatalError');
    const second = expect(ensureHelperProcess()).rejects.toThrow('FatalError');
    failed.emit('error', 'FatalError', 'node::Start', '{"header":{}}');
    await Promise.all([first, second]);

    const retry = ensureHelperProcess();
    expect(mocks.fork).toHaveBeenCalledTimes(2);
    recovered.emit('spawn');
    await expect(retry).resolves.toBeDefined();
  });

  test('exit before spawn rejects readiness rather than hanging', async () => {
    const failed = child();
    const recovered = child();
    mocks.fork.mockReturnValueOnce(failed).mockReturnValueOnce(recovered);
    const { ensureHelperProcess } =
      await import('../../src/main/helper-process');
    const rejection = expect(ensureHelperProcess()).rejects.toThrow(
      /exited.*7/i
    );
    failed.emit('exit', 7);
    await rejection;
    const retry = ensureHelperProcess();
    recovered.emit('spawn');
    await expect(retry).resolves.toBeDefined();
    expect(mocks.fork).toHaveBeenCalledTimes(2);
  });

  test('late events from a failed helper cannot evict its replacement', async () => {
    const failed = child();
    const recovered = child();
    mocks.fork.mockReturnValueOnce(failed).mockReturnValueOnce(recovered);
    const { ensureHelperProcess } =
      await import('../../src/main/helper-process');
    const rejection = expect(ensureHelperProcess()).rejects.toThrow(
      'Fork failed'
    );
    failed.emit('error', new Error('Fork failed'));
    await rejection;

    const retry = ensureHelperProcess();
    failed.emit('exit', 1);
    const concurrent = ensureHelperProcess();
    expect(mocks.fork).toHaveBeenCalledTimes(2);
    recovered.emit('spawn');
    const replacement = await retry;
    expect(await concurrent).toBe(replacement);
    failed.emit('error', new Error('Late error'));
    expect(await ensureHelperProcess()).toBe(replacement);
    expect(mocks.fork).toHaveBeenCalledTimes(2);
  });
});
