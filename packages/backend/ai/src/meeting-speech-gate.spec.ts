import { describe, expect, test } from 'vitest';

import {
  initialMixedCaptureSpeechGate,
  shouldFinalizeMixedCaptureUtterance,
} from './meetings.js';

describe('meeting speech gate', () => {
  test('does not learn opening speech as the meeting noise floor', () => {
    const openingSpeech = initialMixedCaptureSpeechGate(0.08, false);
    expect(openingSpeech.speech).toBe(true);
    expect(openingSpeech.noiseFloorRms).toBeCloseTo(0.006 / 1.4);

    const openingSilence = initialMixedCaptureSpeechGate(0.001, false);
    expect(openingSilence).toEqual({
      noiseFloorRms: 0.001,
      speech: false,
    });
  });

  test('commits continuous speech at a bounded live interval', () => {
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 19_999,
        utteranceStartMs: 0,
        windowEndMs: 19_999,
      })
    ).toBe(false);
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 20_000,
        utteranceStartMs: 0,
        windowEndMs: 20_000,
      })
    ).toBe(true);
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 1_000,
        utteranceStartMs: 0,
        windowEndMs: 3_000,
      })
    ).toBe(true);
  });

  test('cuts long speech at a short pause instead of mid-word', () => {
    // Past 10 s a 150 ms pause is enough; before that it is not.
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 11_000,
        utteranceStartMs: 0,
        windowEndMs: 11_150,
      })
    ).toBe(true);
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 11_000,
        utteranceStartMs: 0,
        windowEndMs: 11_100,
      })
    ).toBe(false);
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 5_000,
        utteranceStartMs: 0,
        windowEndMs: 5_150,
      })
    ).toBe(false);
  });

  test('finalizes offline native decoding after a short silence', () => {
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 1_000,
        silenceFinalizeMs: 400,
        utteranceStartMs: 0,
        windowEndMs: 1_399,
      })
    ).toBe(false);
    expect(
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs: 1_000,
        silenceFinalizeMs: 400,
        utteranceStartMs: 0,
        windowEndMs: 1_400,
      })
    ).toBe(true);
  });
});
