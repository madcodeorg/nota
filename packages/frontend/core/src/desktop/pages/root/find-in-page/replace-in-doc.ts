import type { BlockModel, Store } from '@blocksuite/affine/store';
import type * as Y from 'yjs';

export interface DocTextMatch {
  blockId: string;
  index: number;
  length: number;
}

export interface ReplaceInDocOptions {
  caseSensitive?: boolean;
}

type TextCapableBlock = BlockModel & {
  text?: {
    yText: Y.Text;
  };
};

function getTextBlocksInOrder(doc: Store): TextCapableBlock[] {
  const root = doc.root;
  if (!root) {
    return [];
  }
  const blocks: TextCapableBlock[] = [];
  const visit = (model: BlockModel) => {
    const candidate = model as TextCapableBlock;
    if (model.flavour !== 'affine:page' && candidate.text?.yText) {
      blocks.push(candidate);
    }
    for (const child of model.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return blocks;
}

function getAttributesAtOffset(
  yText: Y.Text,
  offset: number
): Record<string, unknown> | undefined {
  const delta = yText.toDelta() as Array<{
    insert?: unknown;
    attributes?: Record<string, unknown>;
  }>;
  let cursor = 0;
  for (const op of delta) {
    const length = typeof op.insert === 'string' ? op.insert.length : 1;
    if (offset >= cursor && offset < cursor + length) {
      return op.attributes ? { ...op.attributes } : undefined;
    }
    cursor += length;
  }
  return undefined;
}

export function findMatchesInText(
  haystack: string,
  query: string,
  options?: ReplaceInDocOptions
): Array<{ index: number; length: number }> {
  if (!query) {
    return [];
  }
  const source = options?.caseSensitive ? haystack : haystack.toLowerCase();
  const needle = options?.caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ index: number; length: number }> = [];
  let fromIndex = 0;
  while (fromIndex <= source.length - needle.length) {
    const found = source.indexOf(needle, fromIndex);
    if (found === -1) {
      break;
    }
    matches.push({ index: found, length: query.length });
    fromIndex = found + needle.length;
  }
  return matches;
}

export function findTextMatchesInDoc(
  doc: Store,
  query: string,
  options?: ReplaceInDocOptions
): DocTextMatch[] {
  if (!query) {
    return [];
  }
  const results: DocTextMatch[] = [];
  for (const block of getTextBlocksInOrder(doc)) {
    const yText = block.text?.yText;
    if (!yText) continue;
    for (const match of findMatchesInText(yText.toString(), query, options)) {
      results.push({
        blockId: block.id,
        index: match.index,
        length: match.length,
      });
    }
  }
  return results;
}

export function replaceMatchInDoc(
  doc: Store,
  query: string,
  replacement: string,
  options?: ReplaceInDocOptions & { occurrenceIndex?: number }
): { replaced: boolean; remaining: number } {
  if (doc.readonly || !query) {
    return { replaced: false, remaining: 0 };
  }
  const matches = findTextMatchesInDoc(doc, query, options);
  if (!matches.length) {
    return { replaced: false, remaining: 0 };
  }
  const requested = options?.occurrenceIndex ?? 0;
  const targetIndex =
    requested >= 0 && requested < matches.length ? requested : 0;
  const target = matches[targetIndex];
  const block = doc.getBlock(target.blockId)?.model as
    TextCapableBlock | undefined;
  const yText = block?.text?.yText;
  if (!yText) {
    return { replaced: false, remaining: matches.length };
  }

  const attrs = getAttributesAtOffset(yText, target.index);
  doc.captureSync();
  doc.transact(() => {
    yText.delete(target.index, target.length);
    if (replacement.length > 0) {
      yText.insert(target.index, replacement, attrs);
    }
  });

  const remaining = findTextMatchesInDoc(doc, query, options).length;
  return { replaced: true, remaining };
}

export function replaceAllInDoc(
  doc: Store,
  query: string,
  replacement: string,
  options?: ReplaceInDocOptions
): { replacedCount: number; blocksTouched: number } {
  if (doc.readonly || !query) {
    return { replacedCount: 0, blocksTouched: 0 };
  }
  const blocks = getTextBlocksInOrder(doc);
  const edits: Array<{
    yText: Y.Text;
    matches: Array<{ index: number; length: number }>;
  }> = [];

  for (const block of blocks) {
    const yText = block.text?.yText;
    if (!yText) continue;
    const matches = findMatchesInText(yText.toString(), query, options);
    if (matches.length > 0) {
      edits.push({ yText, matches });
    }
  }

  if (!edits.length) {
    return { replacedCount: 0, blocksTouched: 0 };
  }

  let replacedCount = 0;
  doc.captureSync();
  doc.transact(() => {
    for (const { yText, matches } of edits) {
      // Apply in reverse order so earlier character offsets remain valid.
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const attrs = getAttributesAtOffset(yText, match.index);
        yText.delete(match.index, match.length);
        if (replacement.length > 0) {
          yText.insert(match.index, replacement, attrs);
        }
        replacedCount++;
      }
    }
  });

  return { replacedCount, blocksTouched: edits.length };
}
