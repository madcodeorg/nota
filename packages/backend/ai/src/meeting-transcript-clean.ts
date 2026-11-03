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
  'please subscribe',
  'thank you',
  'thank you for watching',
  'thank you so much',
  'thank you very much',
  'thanks',
  'thanks for watching',
  'um',
  'uh',
  'you',
]);

// Whisper loops on noise, e.g. "Thank you. Thank you." or "you you you".
const FILLER_ALTERNATION = [...ISOLATED_FILLER]
  .sort((a, b) => b.length - a.length)
  .join('|');
const REPEATED_FILLER = new RegExp(
  `^(?:${FILLER_ALTERNATION})(?: (?:${FILLER_ALTERNATION}))+$`
);

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
  return ISOLATED_FILLER.has(words) || REPEATED_FILLER.test(words);
}
