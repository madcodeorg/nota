import { describe, expect, test, vi } from 'vitest';

import {
  createMeetingAudioPostState,
  drainMeetingAudioArchive,
  type MeetingAudioByteFrame,
  postMeetingAudioBytes,
  retryMeetingAudioOperation,
  takeMeetingAudioSamples,
} from './meeting-audio-retry';

describe('drainMeetingAudioArchive', () => {
  test('reads bounded archive windows until EOF', async () => {
    const read = vi.fn(async (cursor: number) => {
      if (cursor === 0) {
        return { nextCursor: 4, pcmBytes: new Uint8Array(4).fill(1) };
      }
      if (cursor === 4) {
        return { nextCursor: 10, pcmBytes: new Uint8Array(6).fill(2) };
      }
      return { nextCursor: cursor, pcmBytes: new Uint8Array() };
    });
    const post = vi.fn(async (pcmBytes: Uint8Array, startCursor: number) => {
      return startCursor + pcmBytes.byteLength;
    });

    await expect(
      drainMeetingAudioArchive({
        post,
        read,
        requireComplete: true,
        startCursor: 0,
      })
    ).resolves.toBe(10);

    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([0, 4, 10]);
    expect(post).toHaveBeenCalledTimes(3);
  });
});

describe('postMeetingAudioBytes', () => {
  test('keeps a lost 100ms frame exact when Stop sees another 150ms', async () => {
    const first100Ms = new Uint8Array(3200).fill(1);
    const next150Ms = new Uint8Array(4800).fill(2);
    const stoppedArchive = new Uint8Array(
      first100Ms.byteLength + next150Ms.byteLength
    );
    stoppedArchive.set(first100Ms, 0);
    stoppedArchive.set(next150Ms, first100Ms.byteLength);
    const state = createMeetingAudioPostState();
    const calls: MeetingAudioByteFrame[] = [];
    const postFrame = vi.fn(async (frame: MeetingAudioByteFrame) => {
      calls.push(frame);
      if (calls.length === 1) {
        // The backend accepted this frame, but the renderer lost its response.
        throw new Error('response lost');
      }
    });

    await expect(
      postMeetingAudioBytes({
        byteAlignment: 4,
        chunkBytes: stoppedArchive.byteLength,
        pcmBytes: first100Ms,
        postFrame,
        startCursor: 0,
        state,
        streamKey: 'meeting-1:8000:1',
      })
    ).resolves.toBe(0);

    await expect(
      postMeetingAudioBytes({
        byteAlignment: 4,
        chunkBytes: stoppedArchive.byteLength,
        pcmBytes: stoppedArchive,
        postFrame,
        startCursor: 0,
        state,
        streamKey: 'meeting-1:8000:1',
      })
    ).resolves.toBe(stoppedArchive.byteLength);

    expect(postFrame).toHaveBeenCalledTimes(3);
    expect(calls[1]).toBe(calls[0]);
    expect(calls[1].pcmBytes).toBe(calls[0].pcmBytes);
    expect(calls[1]).toMatchObject({
      endCursor: first100Ms.byteLength,
      startCursor: 0,
    });
    expect(calls[1].pcmBytes).toEqual(first100Ms);
    expect(calls[2]).toMatchObject({
      endCursor: stoppedArchive.byteLength,
      startCursor: first100Ms.byteLength,
    });
    expect(calls[2].pcmBytes).toEqual(next150Ms);
    expect(state.retryFrame).toBeNull();
  });
});

describe('takeMeetingAudioSamples', () => {
  test('bounds a retained backlog without changing sample order', () => {
    const chunks = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];

    const first = takeMeetingAudioSamples(chunks, 4);
    const second = takeMeetingAudioSamples(chunks, 4);

    expect(first.sampleCount).toBe(4);
    expect([...first.chunks[0], ...first.chunks[1]]).toEqual([1, 2, 3, 4]);
    expect(second.sampleCount).toBe(2);
    expect([...second.chunks[0]]).toEqual([5, 6]);
    expect(chunks).toEqual([]);
  });
});

describe('retryMeetingAudioOperation', () => {
  test('retries a transient local-backend failure without losing the operation', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue('posted');
    const wait = vi.fn(async () => {});

    await expect(
      retryMeetingAudioOperation(operation, {
        delaysMs: [10, 20],
        wait,
      })
    ).resolves.toBe('posted');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 10);
    expect(wait).toHaveBeenNthCalledWith(2, 20);
  });

  test('rethrows after the bounded retry budget', async () => {
    const operation = vi.fn(async () => {
      throw new Error('still offline');
    });

    await expect(
      retryMeetingAudioOperation(operation, {
        delaysMs: [0],
        wait: async () => {},
      })
    ).rejects.toThrow('still offline');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
