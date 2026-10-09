import { describe, expect, it } from 'vitest';

import {
  cleanTranscriptText,
  isIsolatedFillerLine,
} from './meeting-transcript-clean';
import { replaceLiveSegmentsWithRecovery } from './meetings';

describe('cleanTranscriptText', () => {
  it('strips Whisper tags, >> markers and leading dashes', () => {
    expect(cleanTranscriptText('[BLANK_AUDIO] Okay, so >> hello')).toBe(
      'Okay, so hello'
    );
    expect(cleanTranscriptText('[XBOX SOUND] Too good.')).toBe('Too good.');
    expect(cleanTranscriptText('- Too good. - And another')).toBe(
      'Too good. - And another'
    );
    expect(cleanTranscriptText('[BLANK_AUDIO]')).toBe('');
  });

  it('keeps ordinary punctuation and hyphenated words', () => {
    expect(cleanTranscriptText('Well-known, 10-15 minutes.')).toBe(
      'Well-known, 10-15 minutes.'
    );
  });
});

describe('isIsolatedFillerLine', () => {
  it('drops short isolated filler only', () => {
    expect(isIsolatedFillerLine('Thank you.', 1200)).toBe(true);
    expect(isIsolatedFillerLine('Hmm.', 800)).toBe(true);
    expect(isIsolatedFillerLine('Come on.', 1000)).toBe(true);
    expect(isIsolatedFillerLine('Thank you.', 9000)).toBe(false);
    expect(isIsolatedFillerLine('Thank you for joining today.', 1500)).toBe(
      false
    );
    expect(isIsolatedFillerLine('Okay.', 800)).toBe(false);
  });
});

describe('replaceLiveSegmentsWithRecovery', () => {
  const segment = (
    id: string,
    startMs: number,
    endMs: number,
    source: 'mic' | 'system' = 'mic',
    type: 'final' | 'partial' = 'final'
  ) => ({
    createdAt: '',
    endMs,
    id,
    meetingId: 'm',
    source,
    startMs,
    text: id,
    type,
  });

  it('removes live finals the recovered segment covers and keeps the rest', () => {
    const runtime = {
      transcriptSegments: [
        segment('live-1', 0, 15000),
        segment('live-2', 15000, 30000),
        segment('other-source', 0, 15000, 'system'),
        segment('later', 40000, 50000),
      ],
    };
    replaceLiveSegmentsWithRecovery(runtime, {
      endMs: 20000,
      source: 'mic',
      startMs: 0,
    });
    expect(runtime.transcriptSegments.map(item => item.id)).toEqual([
      'live-2',
      'other-source',
      'later',
    ]);
  });
});
