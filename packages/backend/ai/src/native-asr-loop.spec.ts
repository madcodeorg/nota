import { describe, expect, test } from 'vitest';

import { isLowConfidenceRecognition } from './native-asr';

const confident = (text: string) => ({
  avgLogprob: -0.2,
  noSpeechProb: 0.01,
  text,
});
const seconds = (n: number) => n * 16000;

describe('runaway Whisper loops', () => {
  test('keeps a list that repeats its sentence opening', () => {
    expect(
      isLowConfidenceRecognition(
        confident(
          'We need to review the budget, we need to contact suppliers, we need to update the schedule, and we need to inform the team'
        ),
        seconds(15)
      )
    ).toBe(false);
  });

  test('keeps a short list with the same opening', () => {
    expect(
      isLowConfidenceRecognition(
        confident('we need to go, we need to eat, we need to sleep'),
        seconds(5)
      )
    ).toBe(false);
  });

  test('drops a phrase repeated back to back', () => {
    expect(
      isLowConfidenceRecognition(
        confident(
          'Thank you for watching. Thank you for watching. Thank you for watching.'
        ),
        seconds(10)
      )
    ).toBe(true);
  });

  test('drops output a single phrase dominates', () => {
    expect(
      isLowConfidenceRecognition(
        confident('see you next time see you next time bye see you next time'),
        seconds(8)
      )
    ).toBe(true);
  });
});
