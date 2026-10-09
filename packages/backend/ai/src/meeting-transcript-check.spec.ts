import { describe, expect, test } from 'vitest';

import { applyTranscriptCheck } from './meeting-transcript-check';

const lines = [
  {
    endMs: 26_000,
    startMs: 1_000,
    text: 'I have been living in India for eight and a half years.',
  },
  {
    endMs: 28_000,
    startMs: 1_000,
    text: 'I have been living in Indiana for eight and a half years',
  },
  { endMs: 45_000, startMs: 44_000, text: 'Thank you.' },
  {
    endMs: 60_000,
    startMs: 46_000,
    text: 'Bro, I ate 10 hamburgers back to back.',
  },
];

describe('transcript check guardrails', () => {
  test('removes an overlapping duplicate and short filler', () => {
    const result = applyTranscriptCheck(lines, {
      fixes: [],
      remove: [
        { line: 2, reason: 'duplicate' },
        { line: 3, reason: 'hallucination' },
      ],
    });
    expect(result.removed).toBe(2);
    expect(result.lines.map(line => line.startMs)).toEqual([1_000, 46_000]);
  });

  test('refuses to remove real speech the model mislabels', () => {
    const result = applyTranscriptCheck(lines, {
      fixes: [],
      remove: [
        { line: 4, reason: 'hallucination' },
        { line: 4, reason: 'duplicate' },
      ],
    });
    expect(result.removed).toBe(0);
    expect(result.lines).toHaveLength(4);
  });

  test('never removes both copies of a duplicate pair', () => {
    const result = applyTranscriptCheck(lines, {
      fixes: [],
      remove: [
        { line: 1, reason: 'duplicate' },
        { line: 2, reason: 'duplicate' },
      ],
    });
    expect(result.removed).toBe(1);
  });

  test('accepts a small word fix and rejects a rewrite', () => {
    const result = applyTranscriptCheck(lines, {
      fixes: [
        {
          line: 2,
          text: 'I have been living in India for eight and a half years',
        },
        { line: 4, text: 'The team agreed to ship the release on Friday.' },
        { line: 9, text: 'out of range' },
      ],
      remove: [],
    });
    expect(result.fixed).toBe(1);
    expect(result.lines[1].text).toContain('in India for');
    expect(result.lines[3].text).toBe(lines[3].text);
  });

  test('maps line numbers across batches', () => {
    const result = applyTranscriptCheck(
      lines.slice(2),
      { fixes: [], remove: [{ line: 3, reason: 'hallucination' }] },
      2
    );
    expect(result.lines.map(line => line.text)).toEqual([lines[3].text]);
  });
});
