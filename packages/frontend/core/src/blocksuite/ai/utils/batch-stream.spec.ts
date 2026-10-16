import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createStreamBatcher } from './batch-stream';

describe('createStreamBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('batches chunks pushed in the same tick into one update', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const apply = vi.fn();
    const batcher = createStreamBatcher(apply);
    batcher.push('a');
    batcher.push('b');
    batcher.push('c');
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  test('flush applies pending chunks synchronously and cancels timers', () => {
    const apply = vi.fn();
    const batcher = createStreamBatcher(apply);
    batcher.push('a');
    batcher.push('b');
    batcher.flush();
    expect(apply).toHaveBeenCalledWith(['a', 'b']);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('flush with nothing pending does not call apply', () => {
    const apply = vi.fn();
    createStreamBatcher(apply).flush();
    expect(apply).not.toHaveBeenCalled();
  });

  test('timeout still fires when animation frames never run', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const apply = vi.fn();
    const batcher = createStreamBatcher(apply);
    batcher.push('a');
    vi.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledWith(['a']);
  });

  test('keeps chunks from later batches in order with no loss', () => {
    const apply = vi.fn();
    const batcher = createStreamBatcher(apply);
    batcher.push('a');
    batcher.flush();
    batcher.push('b');
    batcher.flush();
    expect(apply.mock.calls.flat(2)).toEqual(['a', 'b']);
  });
});
