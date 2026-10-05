import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { calendarHandlers } from '../../src/main/calendar/eventkit';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  nativeRequire: vi.fn(),
  isMacOS: vi.fn(),
}));

vi.mock('node:fs', () => ({ default: { existsSync: mocks.existsSync } }));
vi.mock('node:module', () => ({ createRequire: () => mocks.nativeRequire }));
vi.mock('../../src/shared/utils', () => ({ isMacOS: mocks.isMacOS }));
vi.mock('../../src/main/security/open-external', () => ({
  openMacSystemSettings: vi.fn(),
}));
vi.mock('../../src/main/security/permission-client', () => ({
  getMacOSPermissionClient: () => ({
    bundleIdentifier: 'test.nota',
    displayName: 'Test Nota',
    kind: 'development-host',
  }),
}));

type Status = {
  available: boolean;
  authorized: boolean;
  status:
    | 'not-determined'
    | 'authorized'
    | 'denied'
    | 'restricted'
    | 'unknown'
    | 'write-only';
  supported: boolean;
  requestPending?: boolean;
};
type Callback = (error: Error | null, status?: Status) => void;

describe('EventKit permission lifecycle', () => {
  let handlers: typeof calendarHandlers;
  let status: Status;
  let callbacks: Callback[];
  let binding: {
    getAppleCalendarStatus: ReturnType<typeof vi.fn>;
    requestAppleCalendarAccess: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.isMacOS.mockReturnValue(true);
    mocks.existsSync.mockReturnValue(true);
    status = {
      available: true,
      authorized: false,
      status: 'not-determined',
      supported: true,
      requestPending: false,
    };
    callbacks = [];
    binding = {
      getAppleCalendarStatus: vi.fn(() => ({ ...status })),
      requestAppleCalendarAccess: vi.fn((callback: Callback) => {
        status.requestPending = true;
        callbacks.push(callback);
      }),
    };
    mocks.nativeRequire.mockReturnValue(binding);
    handlers = (await import('../../src/main/calendar/eventkit'))
      .calendarHandlers;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function complete(next: Status['status'], error: Error | null = null) {
    status = {
      ...status,
      authorized: next === 'authorized',
      status: next,
      requestPending: false,
    };
    callbacks.at(-1)!(error, { ...status });
  }

  it('retries a missing binding and caches only a successful load', async () => {
    mocks.existsSync.mockReturnValue(false);
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      available: false,
      status: 'unknown',
    });
    mocks.existsSync.mockReturnValue(true);
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      available: true,
      status: 'not-determined',
    });
    await handlers.getLocalCalendarStatus();
    expect(mocks.nativeRequire).toHaveBeenCalledOnce();
    expect(binding.requestAppleCalendarAccess).not.toHaveBeenCalled();
  });

  it('retries require failures without reloading a working binding', async () => {
    mocks.nativeRequire.mockImplementation(() => {
      throw new Error('temporarily unloadable');
    });
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      available: false,
      reason: 'temporarily unloadable',
    });
    mocks.nativeRequire.mockReturnValue(binding);
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      available: true,
    });
    const loads = mocks.nativeRequire.mock.calls.length;
    await handlers.getLocalCalendarStatus();
    expect(mocks.nativeRequire).toHaveBeenCalledTimes(loads);
  });

  it.each([undefined, null, 0, 'false'])(
    'refuses a native binding with requestPending=%j before consent',
    async requestPending => {
      binding.getAppleCalendarStatus.mockReturnValue({
        ...status,
        requestPending,
      });
      for (const result of [
        await handlers.getLocalCalendarStatus(),
        await handlers.requestLocalCalendarAccess(),
      ]) {
        expect(result).toMatchObject({
          available: false,
          authorized: false,
          status: 'unknown',
        });
        expect(result.reason).toContain(
          'Rebuild the calendar native binding and restart Nota.'
        );
      }
      expect(binding.requestAppleCalendarAccess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('rejects an incompatible callback without throwing on the callback queue', async () => {
    const request = handlers.requestLocalCalendarAccess();
    delete status.requestPending;
    expect(() => callbacks[0](null, { ...status })).not.toThrow();
    expect(await request).toMatchObject({
      available: false,
      reason: expect.stringContaining('Rebuild the calendar native binding'),
    });
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      available: false,
    });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('joins concurrent callers to one native callback and timeout', async () => {
    const first = handlers.requestLocalCalendarAccess();
    const second = handlers.requestLocalCalendarAccess();
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    complete('authorized');
    for (const result of await Promise.all([first, second])) {
      expect(result).toMatchObject({
        authorized: true,
        requestPending: false,
        permissionClient: { displayName: 'Test Nota' },
      });
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the wait without cancelling consent or starting another prompt', async () => {
    const first = handlers.requestLocalCalendarAccess();
    const second = handlers.requestLocalCalendarAccess();
    await vi.advanceTimersByTimeAsync(120_000);
    for (const result of await Promise.all([first, second])) {
      expect(result).toMatchObject({
        available: true,
        authorized: false,
        status: 'not-determined',
        requestPending: true,
      });
      expect(result?.reason).toContain('still waiting for macOS');
    }
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      requestPending: true,
    });
    await vi.advanceTimersByTimeAsync(240_000);
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    complete('authorized');
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      authorized: true,
      requestPending: false,
    });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
  });

  it('recovers authorization through status polling before a late callback', async () => {
    const first = handlers.requestLocalCalendarAccess();
    status.authorized = true;
    status.status = 'authorized';
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      authorized: true,
      requestPending: true,
    });
    expect(await first).toMatchObject({ authorized: true });
    await handlers.requestLocalCalendarAccess();
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    complete('authorized');
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      requestPending: false,
    });
  });

  it('does not overlap a pending native request without a local waiter', async () => {
    status.requestPending = true;
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      requestPending: true,
      authorized: false,
    });
    expect(binding.requestAppleCalendarAccess).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    status.requestPending = false;
    const retry = handlers.requestLocalCalendarAccess();
    complete('authorized');
    expect(await retry).toMatchObject({ authorized: true });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
  });

  it('handles synchronous completion without leaving a pending owner', async () => {
    binding.requestAppleCalendarAccess.mockImplementation(
      (callback: Callback) => {
        status = {
          ...status,
          authorized: true,
          status: 'authorized',
          requestPending: false,
        };
        callback(null, { ...status });
      }
    );
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      authorized: true,
      requestPending: false,
    });
    await handlers.requestLocalCalendarAccess();
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers after a callback returns no status', async () => {
    const first = handlers.requestLocalCalendarAccess();
    status.requestPending = false;
    callbacks[0](null);
    expect(await first).toMatchObject({
      available: false,
      requestPending: false,
      reason: 'Apple Calendar native request returned no status.',
    });
    const retry = handlers.requestLocalCalendarAccess();
    complete('authorized');
    expect(await retry).toMatchObject({ authorized: true });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledTimes(2);
  });

  it('recovers a denial after timeout without requesting consent again', async () => {
    const request = handlers.requestLocalCalendarAccess();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await request).toMatchObject({ requestPending: true });
    complete('denied');
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      available: true,
      authorized: false,
      status: 'denied',
      requestPending: false,
    });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
  });

  it('keeps prompt ownership when the status probe fails at timeout', async () => {
    const request = handlers.requestLocalCalendarAccess();
    binding.getAppleCalendarStatus.mockImplementation(() => {
      throw new Error('worker response timed out');
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await request).toMatchObject({
      available: false,
      status: 'unknown',
      requestPending: true,
    });
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      available: false,
      requestPending: true,
    });
    binding.getAppleCalendarStatus.mockImplementation(() => ({ ...status }));
    complete('authorized');
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      authorized: true,
    });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
  });

  it('allows retry after synchronous pre-submission failure', async () => {
    binding.requestAppleCalendarAccess.mockImplementationOnce(() => {
      throw new Error('worker startup failed');
    });
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      available: false,
      requestPending: false,
      reason: 'worker startup failed',
    });
    const retry = handlers.requestLocalCalendarAccess();
    complete('authorized');
    expect(await retry).toMatchObject({ authorized: true });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledTimes(2);
  });

  it('allows retry after callback failure and ignores duplicate old callbacks', async () => {
    const first = handlers.requestLocalCalendarAccess();
    complete('not-determined', new Error('OS request failed'));
    expect(await first).toMatchObject({ reason: 'OS request failed' });
    const retry = handlers.requestLocalCalendarAccess();
    callbacks[0](null, { ...status, authorized: true, status: 'authorized' });
    expect(vi.getTimerCount()).toBe(1);
    complete('authorized');
    expect(await retry).toMatchObject({ authorized: true });
  });

  it('retries immediately after a recovered worker confirms that the old prompt ended', async () => {
    const first = handlers.requestLocalCalendarAccess();
    await vi.advanceTimersByTimeAsync(120_000);
    await first;
    status.requestPending = false;
    const retry = handlers.requestLocalCalendarAccess();
    const joined = handlers.requestLocalCalendarAccess();
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledTimes(2);
    callbacks[0](null, { ...status, requestPending: false });
    expect(vi.getTimerCount()).toBe(1);
    complete('authorized');
    for (const result of await Promise.all([retry, joined])) {
      expect(result).toMatchObject({ authorized: true });
    }
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledTimes(2);
  });

  it('keeps status checks passive after a timed-out request becomes idle', async () => {
    const first = handlers.requestLocalCalendarAccess();
    await vi.advanceTimersByTimeAsync(120_000);
    await first;
    status.requestPending = false;
    expect(await handlers.getLocalCalendarStatus()).toMatchObject({
      requestPending: false,
      status: 'not-determined',
    });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const retry = handlers.requestLocalCalendarAccess();
    complete('authorized');
    expect(await retry).toMatchObject({ authorized: true });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledTimes(2);
  });

  it('does not release a timed-out owner when native pending state becomes incompatible', async () => {
    const first = handlers.requestLocalCalendarAccess();
    await vi.advanceTimersByTimeAsync(120_000);
    await first;
    delete status.requestPending;
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      available: false,
      requestPending: true,
      reason: expect.stringContaining('Rebuild the calendar native binding'),
    });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
    status.requestPending = false;
    const retry = handlers.requestLocalCalendarAccess();
    complete('authorized');
    expect(await retry).toMatchObject({ authorized: true });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledTimes(2);
  });

  it.each(['authorized', 'denied', 'restricted', 'unknown'] as const)(
    'does not resubmit when explicit retry discovers idle %s status',
    async next => {
      const first = handlers.requestLocalCalendarAccess();
      await vi.advanceTimersByTimeAsync(120_000);
      await first;
      status = {
        ...status,
        authorized: next === 'authorized',
        status: next,
        requestPending: false,
      };
      expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
        status: next,
        requestPending: false,
      });
      expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['available', 'supported'] as const)(
    'does not request consent when native %s is false',
    async field => {
      status[field] = false;
      expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
        [field]: false,
      });
      expect(binding.requestAppleCalendarAccess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it.each(['authorized', 'denied', 'restricted'] as const)(
    'returns known %s permission without requesting it again',
    async next => {
      status.status = next;
      status.authorized = next === 'authorized';
      expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
        status: next,
      });
      expect(binding.requestAppleCalendarAccess).not.toHaveBeenCalled();
    }
  );

  it('requests full access when the current permission is write-only', async () => {
    status.status = 'write-only';
    const request = handlers.requestLocalCalendarAccess();
    complete('authorized');
    expect(await request).toMatchObject({ authorized: true });
    expect(binding.requestAppleCalendarAccess).toHaveBeenCalledOnce();
  });

  it('does not load native code or request access off macOS', async () => {
    mocks.isMacOS.mockReturnValue(false);
    expect(await handlers.requestLocalCalendarAccess()).toMatchObject({
      supported: false,
    });
    expect(mocks.nativeRequire).not.toHaveBeenCalled();
  });
});
