import { describe, expect, it, vi } from 'vitest';

import { finalizeConfirmedMeetingCapture } from './meeting-stop-finalization';

describe('confirmed meeting capture finalization', () => {
  it('persists backend metadata before deleting mic and native recovery data', async () => {
    const order: string[] = [];

    await finalizeConfirmedMeetingCapture({
      finishMicSpool: async () => {
        order.push('mic');
      },
      persistRecordingMetadata: async () => {
        order.push('metadata');
      },
      releaseNativeRecording: async () => {
        order.push('native');
      },
    });

    expect(order).toEqual(['metadata', 'mic', 'native']);
  });

  it('keeps both local recovery artifacts when metadata persistence fails', async () => {
    const finishMicSpool = vi.fn();
    const releaseNativeRecording = vi.fn();

    await expect(
      finalizeConfirmedMeetingCapture({
        finishMicSpool,
        persistRecordingMetadata: async () => {
          throw new Error('patch failed');
        },
        releaseNativeRecording,
      })
    ).rejects.toThrow('patch failed');

    expect(finishMicSpool).not.toHaveBeenCalled();
    expect(releaseNativeRecording).not.toHaveBeenCalled();
  });

  it('keeps the native archive when mic spool cleanup fails', async () => {
    const releaseNativeRecording = vi.fn();

    await expect(
      finalizeConfirmedMeetingCapture({
        finishMicSpool: async () => {
          throw new Error('mic cleanup failed');
        },
        persistRecordingMetadata: async () => {},
        releaseNativeRecording,
      })
    ).rejects.toThrow('mic cleanup failed');

    expect(releaseNativeRecording).not.toHaveBeenCalled();
  });
});
