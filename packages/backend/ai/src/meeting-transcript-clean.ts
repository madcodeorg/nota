// Whisper emits non-speech tags and hallucinates short filler on silence.
// Clean final text before it reaches the transcript.

const ISOLATED_FILLER = new Set([
  'bye',
  'bye bye',
  'come on',
  'god',
  'hmm',
  'mm',
  'mmm',
  'oh',
  'thank you',
  'thanks',
  'thanks for watching',
  'um',
  'uh',
  'you',
]);

// A real answer can be this short, so only very short lines are dropped.
const ISOLATED_FILLER_MAX_MS = 3000;

export function cleanTranscriptText(text: string) {
  return text
    .replace(/\[[^\]\n]{1,40}\]/g, ' ')
    .replace(/>>+/g, ' ')
    .split('\n')
    .map(line =>
      line
        .replace(/^\s*[-\u2013]\s+/, '')
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
}

export function isIsolatedFillerLine(text: string, durationMs: number) {
  if (durationMs > ISOLATED_FILLER_MAX_MS) return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ISOLATED_FILLER.has(words);
}
