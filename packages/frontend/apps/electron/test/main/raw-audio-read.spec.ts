import { describe, expect, it } from 'vitest';

import {
  RAW_AUDIO_READ_CHUNK_BYTES,
  rawAudioReadWindow,
} from '../../src/main/recording/raw-audio-read';

describe('raw audio archive reads', () => {
  it('bounds reads and preserves complete interleaved PCM frames', () => {
    const result = rawAudioReadWindow({
      channels: 3,
      cursor: 0,
      fileSize: RAW_AUDIO_READ_CHUNK_BYTES * 3,
    });

    expect(result.length).toBeLessThanOrEqual(RAW_AUDIO_READ_CHUNK_BYTES);
    expect(result.length % (Float32Array.BYTES_PER_ELEMENT * 3)).toBe(0);
  });

  it('leaves a partial trailing frame for a later write', () => {
    expect(
      rawAudioReadWindow({ channels: 2, cursor: 8, fileSize: 19 })
    ).toEqual({ length: 8, start: 8 });
  });

  it('returns an empty window at end of file', () => {
    expect(
      rawAudioReadWindow({ channels: 2, cursor: 16, fileSize: 16 })
    ).toEqual({ length: 0, start: 16 });
  });

  it('rejects a cursor that could split a PCM frame', () => {
    expect(() =>
      rawAudioReadWindow({ channels: 2, cursor: 4, fileSize: 16 })
    ).toThrow('complete PCM frame');
  });
});
