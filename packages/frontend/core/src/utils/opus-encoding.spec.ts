import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRawAudioBuffers: vi.fn(),
}));

vi.mock('@nota/electron-api', () => ({
  apis: {
    recording: {
      getRawAudioBuffers: mocks.getRawAudioBuffers,
    },
  },
}));

vi.mock('mp4-muxer', () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(4);
  },
  Muxer: class {
    addAudioChunk() {}
    finalize() {}
  },
}));

vi.mock('../modules/navigation/utils', () => ({
  isLink: () => false,
}));

import {
  createStreamEncoder,
  encodeFloat32ArchiveToOpus,
} from './opus-encoding';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Opus stream encoding', () => {
  it('encodes a microphone archive through bounded monotonic reads', async () => {
    const timestamps: number[] = [];
    let closedAudioFrames = 0;
    let encoderClosed = false;

    class FakeAudioData {
      readonly numberOfFrames: number;

      constructor(init: AudioDataInit) {
        this.numberOfFrames = init.numberOfFrames;
        timestamps.push(init.timestamp);
      }

      close() {
        closedAudioFrames += 1;
      }
    }

    class FakeAudioEncoder {
      constructor(_init: AudioEncoderInit) {}

      configure(_config: AudioEncoderConfig) {}

      encode(_data: AudioData) {}

      flush() {
        return Promise.resolve();
      }

      close() {
        encoderClosed = true;
      }
    }

    vi.stubGlobal('AudioData', FakeAudioData);
    vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
    const first = new Uint8Array(new Float32Array([0.1, 0.2]).buffer);
    const second = new Uint8Array(new Float32Array([0.3, 0.4]).buffer);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ buffer: first, nextCursor: 8 })
      .mockResolvedValueOnce({ buffer: second, nextCursor: 16 })
      .mockResolvedValueOnce({ buffer: new Uint8Array(), nextCursor: 16 });

    await expect(
      encodeFloat32ArchiveToOpus({
        numberOfChannels: 1,
        read,
        sampleRate: 16_000,
      })
    ).resolves.toBeInstanceOf(Uint8Array);

    expect(read.mock.calls).toEqual([
      [0, 512 * 1024],
      [8, 512 * 1024],
      [16, 512 * 1024],
    ]);
    expect(timestamps).toEqual([0, 125]);
    expect(closedAudioFrames).toBe(2);
    expect(encoderClosed).toBe(true);
  });

  it('drains every bounded archive chunk with monotonic timestamps', async () => {
    const timestamps: number[] = [];
    let closedAudioFrames = 0;
    let encoderClosed = false;

    class FakeAudioData {
      readonly numberOfFrames: number;

      constructor(init: AudioDataInit) {
        this.numberOfFrames = init.numberOfFrames;
        timestamps.push(init.timestamp);
      }

      close() {
        closedAudioFrames += 1;
      }
    }

    class FakeAudioEncoder {
      constructor(_init: AudioEncoderInit) {}

      configure(_config: AudioEncoderConfig) {}

      encode(_data: AudioData) {}

      flush() {
        return Promise.resolve();
      }

      close() {
        encoderClosed = true;
      }
    }

    vi.stubGlobal('AudioData', FakeAudioData);
    vi.stubGlobal('AudioEncoder', FakeAudioEncoder);

    const first = new Uint8Array(new Float32Array([0.1, 0.2]).buffer);
    const second = new Uint8Array(new Float32Array([0.3, 0.4]).buffer);
    mocks.getRawAudioBuffers
      .mockResolvedValueOnce({ buffer: first, nextCursor: 8 })
      .mockResolvedValueOnce({ buffer: second, nextCursor: 16 })
      .mockResolvedValueOnce({ buffer: new Uint8Array(), nextCursor: 16 });

    const encoder = createStreamEncoder(7, {
      numberOfChannels: 1,
      sampleRate: 16_000,
    });
    await encoder.finish();

    expect(mocks.getRawAudioBuffers.mock.calls).toEqual([
      [7, 0],
      [7, 8],
      [7, 16],
    ]);
    expect(timestamps).toEqual([0, 125]);
    expect(closedAudioFrames).toBe(2);
    expect(encoderClosed).toBe(true);
  });
});
