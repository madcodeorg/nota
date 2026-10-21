import type { Store } from '@blocksuite/affine/store';

// Han, kana and Hangul are written without spaces, so each character counts as
// one word, which matches how word processors count CJK text.
const CJK_CHAR =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const WORDS_PER_MINUTE = 230;

export function countWords(text: string): number {
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  const words = text.replace(CJK_CHAR, ' ').match(WORD)?.length ?? 0;
  return cjk + words;
}

export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export function getDocWordStats(store: Store) {
  const parts: string[] = [];
  for (const model of store.getAllModels()) {
    const text = model.text?.toString();
    if (text) parts.push(text);
  }
  const words = countWords(parts.join('\n'));
  return { words, minutes: readingMinutes(words) };
}
