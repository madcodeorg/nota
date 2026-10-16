/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { startScopedViewTransition } from './view-transition';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installTransition() {
  const ready = deferred();
  const finished = deferred();
  const updateCallbackDone = deferred();
  const transition = {
    ready: ready.promise,
    finished: finished.promise,
    updateCallbackDone: updateCallbackDone.promise,
    skipTransition: vi.fn(),
  };
  const start = vi.fn(() => transition);
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: start,
  });
  return { ready, finished, updateCallbackDone, transition, start };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (document as Partial<Document>).startViewTransition;
  delete document.body.dataset.modal;
  delete document.body.dataset.other;
});

describe('scoped view transitions', () => {
  test('handles skipped ready rejection while completing normal scope cleanup', async () => {
    const { ready, finished, updateCallbackDone, transition } =
      installTransition();
    const readyCatch = vi.spyOn(ready.promise, 'catch');
    const callback = vi.fn();
    startScopedViewTransition(['modal', 'other'], callback);
    expect(readyCatch).toHaveBeenCalledOnce();
    expect(document.body.dataset.modal !== undefined).toBe(true);
    ready.reject(new DOMException('Transition was skipped', 'AbortError'));
    updateCallbackDone.resolve();
    finished.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.body.dataset.modal !== undefined).toBe(false);
    expect(document.body.dataset.other !== undefined).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
    expect(transition.skipTransition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('observes all callback-failure promises and reports the failure once', async () => {
    const { ready, finished, updateCallbackDone } = installTransition();
    const callbackDoneCatch = vi.spyOn(updateCallbackDone.promise, 'catch');
    startScopedViewTransition('modal', () => {});
    expect(callbackDoneCatch).toHaveBeenCalledOnce();
    const failure = new Error('DOM update failed');
    ready.reject(failure);
    updateCallbackDone.reject(failure);
    finished.reject(failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'View transition[modal] failed: Error: DOM update failed'
    );
    expect(document.body.dataset.modal !== undefined).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('skips a stalled native transition at timeout and releases its scope', async () => {
    const { ready, finished, updateCallbackDone, transition } =
      installTransition();
    transition.skipTransition.mockImplementation(() => {
      ready.reject(new DOMException('Transition was skipped', 'AbortError'));
    });
    startScopedViewTransition('modal', () => {}, { timeout: 25 });
    await vi.advanceTimersByTimeAsync(24);
    expect(transition.skipTransition).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transition.skipTransition).toHaveBeenCalledOnce();
    expect(document.body.dataset.modal !== undefined).toBe(false);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'View transition[modal] failed: Error: View transition timeout'
    );
    updateCallbackDone.resolve();
    finished.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('does not skip a completed transition when its old timeout elapses', async () => {
    const { ready, finished, updateCallbackDone, transition, start } =
      installTransition();
    const callback = vi.fn();
    startScopedViewTransition('modal', callback, { timeout: 25 });
    expect(start).toHaveBeenCalledWith(callback);
    ready.resolve();
    updateCallbackDone.resolve();
    finished.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(transition.skipTransition).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('runs the update directly when the browser lacks view transitions', () => {
    const callback = vi.fn();
    startScopedViewTransition('modal', callback);
    expect(callback).toHaveBeenCalledOnce();
    expect(document.body.dataset.modal !== undefined).toBe(false);
  });
});
