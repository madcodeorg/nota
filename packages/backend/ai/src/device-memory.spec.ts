import os from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { parseMacOSMemoryPressure } from './device-memory';

describe('parseMacOSMemoryPressure', () => {
  test('converts the macOS free percentage into usable bytes', () => {
    expect(
      parseMacOSMemoryPressure(
        'System-wide memory free percentage: 46%\n',
        24 * 1024 ** 3
      )
    ).toBe(Math.round(24 * 1024 ** 3 * 0.46));
  });

  test('accepts decimal percentages', () => {
    expect(
      parseMacOSMemoryPressure(
        'System-wide memory free percentage: 12.5%',
        16 * 1024 ** 3
      )
    ).toBe(2 * 1024 ** 3);
  });

  test('rejects missing and invalid percentages', () => {
    expect(parseMacOSMemoryPressure('no reading', 16 * 1024 ** 3)).toBeNull();
    expect(
      parseMacOSMemoryPressure(
        'System-wide memory free percentage: 101%',
        16 * 1024 ** 3
      )
    ).toBeNull();
  });
});

describe('availableMemoryBytes on macOS', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform!);
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  async function loadOnMac(
    respond: (callback: (error: Error | null, stdout: string) => void) => void
  ) {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.resetModules();
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void
      ) => respond(callback)
    );
    vi.doMock('node:child_process', () => ({ execFile }));
    return { execFile, memory: await import('./device-memory') };
  }

  test('never waits for memory_pressure and refreshes once in the background', async () => {
    const { execFile, memory } = await loadOnMac(callback =>
      callback(null, 'System-wide memory free percentage: 100%\n')
    );

    expect(memory.availableMemoryBytes()).toBe(os.freemem());
    memory.availableMemoryBytes();
    memory.availableMemoryBytes();
    expect(execFile).toHaveBeenCalledTimes(1);

    await memory.refreshAvailableMemory();
    expect(memory.availableMemoryBytes()).toBe(os.totalmem());
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('does not retry a failing utility on every call', async () => {
    const { execFile, memory } = await loadOnMac(callback =>
      callback(new Error('memory_pressure is unavailable'), '')
    );

    await memory.refreshAvailableMemory();
    memory.availableMemoryBytes();
    memory.availableMemoryBytes();

    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
