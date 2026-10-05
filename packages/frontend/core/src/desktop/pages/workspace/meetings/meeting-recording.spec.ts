import { describe, expect, it } from 'vitest';

import {
  ensurePortableMeetingRecording,
  isActiveNativeMeetingRecording,
  isPortableMeetingRecordingBlock,
  isRawMeetingRecording,
  meetingRawRecordingPlaceholderBlockId,
  meetingRecordingPathOnlyMarkdown,
} from './meeting-recording';

describe('meeting recording note handling', () => {
  it('keeps raw captures on disk instead of embedding them', () => {
    expect(isRawMeetingRecording('/tmp/meeting.raw')).toBe(true);
    expect(isRawMeetingRecording('/tmp/meeting.RAW')).toBe(true);
    expect(isRawMeetingRecording('/tmp/meeting.opus')).toBe(false);
  });

  it('keeps local recovery metadata out of syncable note content', () => {
    const markdown = meetingRecordingPathOnlyMarkdown(
      '/Users/alice/Library/Nota/meeting.raw'
    );
    expect(markdown).toContain("Nota's local recordings folder");
    expect(markdown).not.toContain('/Users/');
    expect(markdown).not.toContain('meeting.raw');
  });

  it('keeps a raw placeholder distinct from the future portable attachment', () => {
    const attachmentBlockId = 'nota-meeting-meeting-1-recording';
    const rawPlaceholderBlockId =
      meetingRawRecordingPlaceholderBlockId(attachmentBlockId);

    expect(rawPlaceholderBlockId).toBe(
      'nota-meeting-meeting-1-recording-local-recovery'
    );
    expect(rawPlaceholderBlockId).not.toBe(attachmentBlockId);
    expect(isPortableMeetingRecordingBlock('affine:note')).toBe(false);
    expect(isPortableMeetingRecordingBlock('affine:attachment')).toBe(true);
  });

  it('only treats recording and paused native sessions as active', () => {
    expect(isActiveNativeMeetingRecording({ status: 'recording' })).toBe(true);
    expect(isActiveNativeMeetingRecording({ status: 'paused' })).toBe(true);
    expect(isActiveNativeMeetingRecording({ status: 'stopped' })).toBe(false);
    expect(isActiveNativeMeetingRecording({ status: 'ready' })).toBe(false);
    expect(isActiveNativeMeetingRecording(null)).toBe(false);
  });

  it('encodes raw recordings and returns the desktop-published portable path', async () => {
    const persisted: Uint8Array[] = [];
    let published = false;
    await expect(
      ensurePortableMeetingRecording({
        encode: async () => new Uint8Array([1, 2, 3]),
        persistEncoded: async (_id, buffer) => {
          persisted.push(buffer);
          published = true;
        },
        readCurrent: async () =>
          published
            ? {
                filepath: '/tmp/meeting.opus',
                id: 7,
              }
            : {
                filepath: '/tmp/meeting.raw',
                id: 7,
              },
        recording: {
          filepath: '/tmp/meeting.raw',
          id: 7,
          numberOfChannels: 2,
          sampleRate: 48_000,
        },
      })
    ).resolves.toBe('/tmp/meeting.opus');
    expect(persisted).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it('reuses a portable publication after a later finalization retry', async () => {
    let encoded = false;
    await expect(
      ensurePortableMeetingRecording({
        encode: async () => {
          encoded = true;
          return new Uint8Array([1]);
        },
        persistEncoded: async () => {},
        readCurrent: async () => ({
          filepath: '/tmp/meeting.opus',
          id: 7,
        }),
        recording: {
          filepath: '/tmp/meeting.raw',
          id: 7,
          numberOfChannels: 2,
          sampleRate: 48_000,
        },
      })
    ).resolves.toBe('/tmp/meeting.opus');
    expect(encoded).toBe(false);
  });

  it('keeps already-portable recordings without re-encoding', async () => {
    let encoded = false;
    await expect(
      ensurePortableMeetingRecording({
        encode: async () => {
          encoded = true;
          return new Uint8Array([1]);
        },
        persistEncoded: async () => {},
        readCurrent: async () => null,
        recording: {
          filepath: '/tmp/meeting.opus',
          id: 7,
        },
      })
    ).resolves.toBe('/tmp/meeting.opus');
    expect(encoded).toBe(false);
  });

  it('retains raw recovery data when portable publication is incomplete', async () => {
    await expect(
      ensurePortableMeetingRecording({
        encode: async () => new Uint8Array([1]),
        persistEncoded: async () => {},
        readCurrent: async () => ({
          filepath: '/tmp/meeting.raw',
          id: 7,
        }),
        recording: {
          filepath: '/tmp/meeting.raw',
          id: 7,
          numberOfChannels: 2,
          sampleRate: 48_000,
        },
      })
    ).rejects.toThrow('did not publish its portable file');
  });
});
