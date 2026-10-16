import { describe, expect, test, vi } from 'vitest';

import type { AiBackendConfig } from './config';
import {
  applyTranscriptCheck,
  checkMeetingTranscript,
} from './meeting-transcript-check';
import type { ModelSelection } from './providers';
import { generateBackendObject } from './text-runtime';

vi.mock('./text-runtime', () => ({ generateBackendObject: vi.fn() }));

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
  test('constrains generated corrections to each supplied batch', async () => {
    const generate = vi.mocked(generateBackendObject);
    generate.mockResolvedValue({
      structured: { remove: [], fixes: [] },
      model: 'fixture',
      provider: 'local',
      runtime: 'local-onnx',
    });
    const transcript = Array.from({ length: 61 }, (_, index) => ({
      startMs: index * 1000,
      endMs: (index + 1) * 1000,
      text: 'This line contains actual speech.',
    }));
    const result = await checkMeetingTranscript({
      config: {} as AiBackendConfig,
      selected: {} as ModelSelection,
      lines: transcript,
    });
    expect(result.lines).toEqual(transcript);
    const first = generate.mock.calls[0][0].schema;
    const second = generate.mock.calls[1][0].schema;
    const removal = (line: number) => ({
      remove: [{ line, reason: 'hallucination' }],
      fixes: [],
    });
    expect(first.safeParse(removal(60)).success).toBe(true);
    expect(first.safeParse(removal(61)).success).toBe(false);
    expect(second.safeParse(removal(61)).success).toBe(true);
    expect(second.safeParse(removal(60)).success).toBe(false);
    expect(
      second.safeParse({
        remove: [removal(61).remove[0], removal(61).remove[0]],
        fixes: [],
      }).success
    ).toBe(false);
    expect(
      second.safeParse({
        remove: [],
        fixes: [{ line: 61, text: 'rewritten '.repeat(100) }],
      }).success
    ).toBe(false);
  });
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
