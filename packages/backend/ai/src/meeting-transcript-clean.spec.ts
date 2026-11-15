import { describe, expect, it } from 'vitest';

import {
  cleanTranscriptText,
  isIsolatedFillerLine,
} from './meeting-transcript-clean';
import {
  replaceLiveSegmentsWithRecovery,
  replaceLiveTranscriptWithFullPass,
  sortTranscriptSegments,
  withoutTranscriptDuplicates,
} from './meetings';

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

  it('drops stock noise hallucinations and looped filler when short', () => {
    expect(isIsolatedFillerLine('Thank you very much.', 1300)).toBe(true);
    expect(isIsolatedFillerLine('Thank you for watching!', 2000)).toBe(true);
    expect(isIsolatedFillerLine('Thank you. Thank you.', 1500)).toBe(true);
    expect(isIsolatedFillerLine('You you you', 1500)).toBe(true);
    expect(isIsolatedFillerLine('Thank you very much.', 6000)).toBe(false);
    expect(isIsolatedFillerLine('Thank you, you can go.', 1500)).toBe(false);
    expect(isIsolatedFillerLine('Oh no.', 800)).toBe(false);
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

  it('puts recovered segments back in spoken order', () => {
    const runtime = {
      transcriptSegments: [
        segment('second', 7000, 13000, 'system'),
        segment('mic', 12000, 19000),
        segment('recovered-first', 2000, 6000, 'system'),
      ],
    };
    sortTranscriptSegments(runtime);
    expect(runtime.transcriptSegments.map(item => item.id)).toEqual([
      'recovered-first',
      'second',
      'mic',
    ]);
  });

  it('replaces live finals of either source for a full pass', () => {
    const runtime = {
      transcriptSegments: [
        segment('mislabeled', 0, 10000, 'system'),
        segment('later', 40000, 50000),
      ],
    };
    replaceLiveSegmentsWithRecovery(
      runtime,
      { endMs: 10000, source: 'mic', startMs: 0 },
      { anySource: true }
    );
    expect(runtime.transcriptSegments.map(item => item.id)).toEqual(['later']);
  });

  it('keeps overlapping full-pass phrases from both sources', () => {
    const runtime = {
      transcriptSegments: [
        segment('live', 0, 10000, 'system'),
        segment('later', 40000, 50000),
      ],
    };
    replaceLiveTranscriptWithFullPass(
      runtime,
      [
        segment('improved-mic', 0, 10000),
        segment('improved-system', 0, 10000, 'system'),
      ],
      improved => runtime.transcriptSegments.push(improved)
    );
    expect(runtime.transcriptSegments.map(item => item.id)).toEqual([
      'improved-mic',
      'improved-system',
      'later',
    ]);
  });

  it('keeps the combined transcript in spoken order after a full pass', () => {
    const runtime = { transcriptSegments: [segment('kept', 10000, 12000)] };
    replaceLiveTranscriptWithFullPass(
      runtime,
      [segment('improved', 0, 4000)],
      improved => runtime.transcriptSegments.push(improved)
    );
    expect(runtime.transcriptSegments.map(item => item.id)).toEqual([
      'improved',
      'kept',
    ]);
  });

  it('drops gap recovery that repeats speech the full pass kept', () => {
    const kept = {
      ...segment('improved-system', 0, 5000, 'system'),
      text: 'We ship the Linux build on Friday',
    };
    const recovered = [
      {
        ...segment('mic-echo', 200, 5100),
        text: 'we ship the Linux build on Friday',
      },
      { ...segment('new-speech', 8000, 9000), text: 'Sounds good to me' },
    ];
    expect(
      withoutTranscriptDuplicates(recovered, [kept]).map(item => item.id)
    ).toEqual(['new-speech']);
  });
});
