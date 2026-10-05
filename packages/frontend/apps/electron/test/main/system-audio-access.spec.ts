import { describe, expect, it, vi } from 'vitest';

import { SystemAudioAccessProbe } from '../../src/main/recording/system-audio-access';

describe('SystemAudioAccessProbe', () => {
  it('can read cached state without starting a Core Audio tap', () => {
    const probeSystemAudioAccess = vi.fn();
    const loadRuntime = vi.fn(() => ({ probeSystemAudioAccess }));
    const probe = new SystemAudioAccessProbe(loadRuntime);

    expect(probe.peek()).toBeNull();
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(probeSystemAudioAccess).not.toHaveBeenCalled();

    const checked = probe.check();
    expect(probe.peek()).toBe(checked);
    expect(probeSystemAudioAccess).toHaveBeenCalledOnce();

    probe.peek();
    expect(probeSystemAudioAccess).toHaveBeenCalledOnce();
  });

  it('verifies access by starting and stopping a Core Audio tap', () => {
    let now = 1000;
    const probeSystemAudioAccess = vi.fn();
    const probe = new SystemAudioAccessProbe(
      () => ({ probeSystemAudioAccess }),
      () => now
    );

    expect(probe.check()).toMatchObject({
      available: true,
      reason: null,
      status: 'granted',
    });
    expect(probeSystemAudioAccess).toHaveBeenCalledExactlyOnceWith();

    probe.check();
    expect(probeSystemAudioAccess).toHaveBeenCalledOnce();

    now += 1000;
    probe.check();
    expect(probeSystemAudioAccess).toHaveBeenCalledTimes(2);
  });

  it('reports the native tap error and retries after the failure window', () => {
    let now = 1000;
    const probeSystemAudioAccess = vi.fn(() => {
      throw new Error('Create process tap failed');
    });
    const probe = new SystemAudioAccessProbe(
      () => ({ probeSystemAudioAccess }),
      () => now
    );

    expect(probe.check()).toMatchObject({
      available: false,
      reason: 'Create process tap failed',
      status: 'unknown',
    });
    now += 500;
    probe.check();
    expect(probeSystemAudioAccess).toHaveBeenCalledOnce();

    now += 500;
    probe.check();
    expect(probeSystemAudioAccess).toHaveBeenCalledTimes(2);
  });

  it('can force an immediate retry after opening System Settings', () => {
    const probeSystemAudioAccess = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Permission unavailable');
      })
      .mockImplementationOnce(() => undefined);
    const probe = new SystemAudioAccessProbe(() => ({
      probeSystemAudioAccess,
    }));

    expect(probe.check().available).toBe(false);
    expect(probe.check(true).available).toBe(true);
    expect(probeSystemAudioAccess).toHaveBeenCalledTimes(2);
  });

  it('never uses mixed capture when the system-only probe exists', () => {
    const tapGlobalAudio = vi.fn(() => {
      throw new Error('Microphone capture must never be activated');
    });
    const runtime = { tapGlobalAudio, probeSystemAudioAccess: vi.fn() };
    const probe = new SystemAudioAccessProbe(() => runtime);

    expect(probe.check().available).toBe(true);
    expect(runtime.probeSystemAudioAccess).toHaveBeenCalledExactlyOnceWith();
    expect(tapGlobalAudio).not.toHaveBeenCalled();
  });

  it('fails closed on an older native binary without falling back to mixed capture', () => {
    const tapGlobalAudio = vi.fn();
    const runtime = { tapGlobalAudio, probeSystemAudioAccess: undefined };
    const probe = new SystemAudioAccessProbe(() => runtime);

    expect(probe.check()).toMatchObject({
      available: false,
      status: 'unknown',
      reason:
        'This native runtime does not support system-only audio permission checks. Update the native binding before retrying; microphone capture was not started.',
    });
    expect(tapGlobalAudio).not.toHaveBeenCalled();
  });

  it('does not report access as granted when native cleanup fails', () => {
    const probe = new SystemAudioAccessProbe(() => ({
      probeSystemAudioAccess: () => {
        throw new Error('AudioHardwareDestroyProcessTap failed, status: -1');
      },
    }));

    expect(probe.check()).toMatchObject({
      available: false,
      status: 'unknown',
      reason: 'AudioHardwareDestroyProcessTap failed, status: -1',
    });
  });

  it('reports runtime loading failures without activating capture', () => {
    const probe = new SystemAudioAccessProbe(() => {
      throw new Error('Native binding unavailable');
    });
    expect(probe.check()).toMatchObject({
      available: false,
      status: 'unknown',
      reason: 'Native binding unavailable',
    });
  });

  it('can cache recording-proven access without loading the native runtime', () => {
    const loadRuntime = vi.fn();
    const probe = new SystemAudioAccessProbe(loadRuntime, () => 1234);
    probe.markGranted();
    expect(probe.peek()).toEqual({
      available: true,
      checkedAt: 1234,
      reason: null,
      status: 'granted',
    });
    expect(loadRuntime).not.toHaveBeenCalled();
  });
});
