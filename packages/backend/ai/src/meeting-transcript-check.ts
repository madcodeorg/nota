import { z } from 'zod';

import type { AiBackendConfig } from './config';
import type { ModelSelection } from './providers';
import { generateBackendObject } from './text-runtime';

export interface CheckableTranscriptLine {
  endMs: number;
  startMs: number;
  text: string;
}

const TranscriptCheckSchema = z.object({
  remove: z
    .array(
      z.object({
        line: z.number().int().describe('Line number to remove.'),
        reason: z.enum(['duplicate', 'hallucination']),
      })
    )
    .describe('Lines that repeat another line or are filler noise.'),
  fixes: z
    .array(
      z.object({
        line: z.number().int().describe('Line number to correct.'),
        text: z.string().describe('The same line with misheard words fixed.'),
      })
    )
    .describe('Lines with clearly misheard words.'),
});

export type TranscriptCheck = z.infer<typeof TranscriptCheckSchema>;

const SYSTEM = [
  'You check a speech-to-text meeting transcript for recognition errors.',
  'Remove a line only when it repeats an overlapping line, or when it is a',
  'short filler that speech models invent from silence (for example "you",',
  '"Thank you.", "Bye.").',
  'Fix only words that were clearly misheard, using the surrounding lines.',
  'Never add new content, summarize, reorder, or change meaning.',
  'When unsure, leave the line unchanged.',
].join(' ');

const BATCH_LINES = 60;
const MAX_FILLER_WORDS = 4;
const MAX_CHANGED_WORD_RATIO = 0.35;

function words(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function sharedRatio(from: string[], to: string[]) {
  if (!from.length) return 0;
  const other = new Set(to);
  return from.filter(word => other.has(word)).length / from.length;
}

function time(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  return minutes + ':' + String(total % 60).padStart(2, '0');
}

// Model output is advice. Each suggestion is re-checked here so a small local
// model cannot delete real speech or rewrite a line into new content.
export function applyTranscriptCheck<T extends CheckableTranscriptLine>(
  lines: T[],
  check: TranscriptCheck,
  offset = 0
) {
  const removed = new Set<number>();
  for (const { line, reason } of check.remove) {
    const index = line - 1 - offset;
    const target = lines[index];
    if (!target || removed.has(index)) continue;
    const targetWords = words(target.text);
    if (reason === 'hallucination') {
      if (targetWords.length <= MAX_FILLER_WORDS) removed.add(index);
      continue;
    }
    const repeated = lines.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        !removed.has(otherIndex) &&
        other.startMs < target.endMs + 2000 &&
        other.endMs > target.startMs - 2000 &&
        words(other.text).length >= targetWords.length * 0.8 &&
        sharedRatio(targetWords, words(other.text)) >= 0.6
    );
    if (repeated) removed.add(index);
  }

  const fixed = new Map<number, string>();
  for (const { line, text } of check.fixes) {
    const index = line - 1 - offset;
    const target = lines[index];
    const next = text.trim();
    if (!target || removed.has(index) || !next || next === target.text) {
      continue;
    }
    const before = words(target.text);
    const after = words(next);
    const lengthRatio = after.length / Math.max(1, before.length);
    if (lengthRatio < 0.75 || lengthRatio > 1.25) continue;
    if (1 - sharedRatio(after, before) > MAX_CHANGED_WORD_RATIO) continue;
    fixed.set(index, next);
  }

  return {
    fixed: fixed.size,
    lines: lines.flatMap((line, index) => {
      if (removed.has(index)) return [];
      const text = fixed.get(index);
      return [text ? { ...line, text } : line];
    }),
    removed: removed.size,
  };
}

export async function checkMeetingTranscript<
  T extends CheckableTranscriptLine,
>(input: { config: AiBackendConfig; lines: T[]; selected: ModelSelection }) {
  const result = { fixed: 0, lines: [] as T[], removed: 0 };
  for (let start = 0; start < input.lines.length; start += BATCH_LINES) {
    const batch = input.lines.slice(start, start + BATCH_LINES);
    const prompt = batch
      .map(
        (line, index) =>
          start +
          index +
          1 +
          '. [' +
          time(line.startMs) +
          '-' +
          time(line.endMs) +
          '] ' +
          line.text
      )
      .join('\n');
    const { structured } = await generateBackendObject({
      config: input.config,
      description: 'Conservative transcript corrections.',
      maxOutputTokens: 4000,
      name: 'transcript_check',
      prompt,
      schema: TranscriptCheckSchema,
      selected: input.selected,
      system: SYSTEM,
    });
    const checked = applyTranscriptCheck(batch, structured, start);
    result.lines.push(...checked.lines);
    result.fixed += checked.fixed;
    result.removed += checked.removed;
  }
  return result;
}
