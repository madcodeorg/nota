export interface SourceTitleResolver {
  getDocMeta: (docId: string) => unknown;
  getTitle: (docId: string) => string;
}

const SOURCE_MARKER = /[ \t]*\[source:\s*([^\]\n]+)\]/gi;

/** Extracts the Nota doc id from refs like `nota://ws/doc#line:1-4` or `doc#block`. */
export function docIdFromSourceRef(ref: string): string | undefined {
  const value = ref.trim().replace(/^nota:\/\/[^/]+\//, '');
  const docId = value.split('#')[0]?.trim();
  return docId || undefined;
}

/**
 * The backend and models cite sources as `[source: <internal ref>]`. Those
 * refs are ids, so show the note title instead, and drop the marker when the
 * title is already on the same line (for example in the Sources list).
 */
export function formatSourceCitations(
  text: string,
  resolver?: SourceTitleResolver | null
): string {
  if (!text.includes('[source:') && !text.includes('[Source:')) return text;
  return text.replace(SOURCE_MARKER, (_match, refs: string, offset: number) => {
    const lineStart = text.lastIndexOf('\n', offset) + 1;
    // A string, not a list: `includes` is a substring check.
    // oxlint-disable-next-line unicorn/prefer-set-has
    const lineBefore = text.slice(lineStart, offset);
    const titles = Array.from(
      new Set(
        refs
          .split(/[,;]\s*/)
          .map(ref => docIdFromSourceRef(ref))
          .map(docId =>
            docId && resolver?.getDocMeta(docId)
              ? resolver.getTitle(docId)?.trim()
              : undefined
          )
          .filter(
            (title): title is string => !!title && !lineBefore.includes(title)
          )
      )
    );
    return titles.length ? ` (${titles.join(', ')})` : '';
  });
}
