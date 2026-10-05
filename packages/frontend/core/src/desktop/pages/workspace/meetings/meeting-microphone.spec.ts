import { describe, expect, test, vi } from 'vitest';

import {
  ensureMeetingAudioContextRunning,
  meetingMicrophoneConstraints,
  preferredMeetingMicrophoneDeviceId,
} from './meeting-microphone';

const device = (deviceId: string, kind: MediaDeviceKind, label: string) => ({
  deviceId,
  kind,
  label,
});

describe('meeting microphone startup', () => {
  test('resumes a suspended audio context before capturing', async () => {
    const context = {
      state: 'suspended' as AudioContextState,
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
    };
    await ensureMeetingAudioContextRunning(context);
    expect(context.resume).toHaveBeenCalledOnce();
  });

  test('keeps an already running context running', async () => {
    const context = { state: 'running' as const, resume: vi.fn() };
    await ensureMeetingAudioContextRunning(context);
    expect(context.resume).not.toHaveBeenCalled();
  });

  test('surfaces a context that remains suspended instead of capturing silence', async () => {
    await expect(
      ensureMeetingAudioContextRunning({
        state: 'suspended',
        resume: async () => {},
      })
    ).rejects.toThrow('Microphone audio could not start');
  });
});

describe('meeting microphone selection', () => {
  test('prefers the built-in Mac microphone over a Bluetooth default', () => {
    expect(
      preferredMeetingMicrophoneDeviceId(
        [
          device('default', 'audioinput', 'Default - AirPods Microphone'),
          device('airpods', 'audioinput', 'AirPods Microphone'),
          device('macbook-mic', 'audioinput', 'MacBook Pro Microphone'),
          device('airpods-output', 'audiooutput', 'AirPods'),
        ],
        true
      )
    ).toBe('macbook-mic');
  });

  test('keeps the browser default when no built-in Mac microphone exists', () => {
    expect(
      preferredMeetingMicrophoneDeviceId(
        [device('usb-mic', 'audioinput', 'USB Audio Interface')],
        true
      )
    ).toBeNull();
  });

  test('does not override microphone selection on other platforms', () => {
    expect(
      preferredMeetingMicrophoneDeviceId(
        [device('laptop-mic', 'audioinput', 'Built-in Microphone')],
        false
      )
    ).toBeNull();
  });

  test('uses an exact constraint for the selected built-in microphone', async () => {
    await expect(
      meetingMicrophoneConstraints(
        {
          enumerateDevices: async () =>
            [
              device('headset', 'audioinput', 'Bluetooth Headset'),
              device('internal', 'audioinput', 'Built-in Microphone'),
            ] as MediaDeviceInfo[],
        },
        true
      )
    ).resolves.toEqual({
      autoGainControl: false,
      deviceId: { exact: 'internal' },
      echoCancellation: false,
      noiseSuppression: false,
    });
  });
});
