import { describe, expect, it } from 'vitest';

import { createMeetingTranscriptReplayFilter } from './meeting-transcript-replay';

function segment(id: string) {
  return {
    id,
    meetingId: 'meeting-1',
    type: 'final',
    text: `Transcript ${id}`,
    startMs: 1000,
    endMs: 2000,
    source: 'mic',
    confidence: 0.9,
    createdAt: '2026-09-21T12:00:00Z',
  };
}

describe('meeting transcript snapshot replay', () => {
  it('skips all exact finals in a long reconnect replay', () => {
    const filter =
      createMeetingTranscriptReplayFilter<ReturnType<typeof segment>>();
    const segments = Array.from({ length: 10_000 }, (_, i) => segment(`${i}`));
    filter.reset(segments);
    const delivered = segments
      .map(value => JSON.parse(JSON.stringify(value)))
      .filter(value => !filter.isReplay(value));

    expect(delivered).toEqual([]);
    expect(filter.isReplay(segment('new-final'))).toBe(false);
    expect(segments).toHaveLength(10_000);
  });

  it('compares payload values independently of JSON property order', () => {
    const filter =
      createMeetingTranscriptReplayFilter<ReturnType<typeof segment>>();
    const original = segment('1');
    filter.reset([original]);

    const { text, ...rest } = original;
    expect(filter.isReplay({ text, ...rest })).toBe(true);
  });

  it.each([
    { text: 'Corrected transcript' },
    { startMs: 900 },
    { endMs: 2400 },
    { source: 'system' },
    { confidence: 0.8 },
  ])('delivers a same-ID revision: %o', revision => {
    const filter =
      createMeetingTranscriptReplayFilter<ReturnType<typeof segment>>();
    filter.reset([segment('1')]);

    expect(filter.isReplay({ ...segment('1'), ...revision })).toBe(false);
  });

  it('replaces the snapshot on subsequent reconnects, including empty snapshots', () => {
    const filter =
      createMeetingTranscriptReplayFilter<ReturnType<typeof segment>>();
    filter.reset([segment('old')]);
    filter.reset([segment('new')]);

    expect(filter.isReplay(segment('old'))).toBe(false);
    expect(filter.isReplay(segment('new'))).toBe(true);
    filter.reset([segment('new')]);
    expect(filter.isReplay(segment('new'))).toBe(true);
    filter.reset([]);
    expect(filter.isReplay(segment('new'))).toBe(false);
  });

  it('does not suppress events before a snapshot or after its replay is consumed', () => {
    const filter =
      createMeetingTranscriptReplayFilter<ReturnType<typeof segment>>();
    expect(filter.isReplay(segment('1'))).toBe(false);
    filter.reset([segment('1')]);
    expect(filter.isReplay(segment('1'))).toBe(true);
    expect(filter.isReplay(segment('1'))).toBe(false);
  });
});
