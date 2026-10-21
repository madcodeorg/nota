const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isMentionableTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length >= 3 && trimmed.toLowerCase() !== 'untitled';
}

/**
 * Finds a case-insensitive, whole-word occurrence of a page title. CJK titles
 * have no word boundaries, so they match anywhere.
 */
export function findMention(
  content: string,
  title: string
): { index: number; length: number } | null {
  const trimmed = title.trim();
  if (!isMentionableTitle(trimmed)) return null;
  const pattern = CJK.test(trimmed)
    ? escapeRegExp(trimmed)
    : `(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`;
  const match = new RegExp(pattern, 'iu').exec(content);
  return match ? { index: match.index, length: match[0].length } : null;
}

export function mentionSnippet(
  content: string,
  match: { index: number; length: number },
  radius = 60
) {
  const start = Math.max(0, match.index - radius);
  const end = Math.min(content.length, match.index + match.length + radius);
  return {
    before: (start > 0 ? '…' : '') + content.slice(start, match.index),
    match: content.slice(match.index, match.index + match.length),
    after:
      content.slice(match.index + match.length, end) +
      (end < content.length ? '…' : ''),
  };
}
