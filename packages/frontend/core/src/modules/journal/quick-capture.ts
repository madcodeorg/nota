import { Text } from '@blocksuite/affine/store';
import dayjs from 'dayjs';

import type { Workspace } from '../workspace';
import { JournalService } from './services/journal';

export type QuickCaptureBlock =
  | { flavour: 'affine:paragraph'; text: string }
  | {
      flavour: 'affine:list';
      type: 'bulleted' | 'numbered' | 'todo';
      checked: boolean;
      text: string;
    };

const TODO = /^(?:[-*]\s+)?\[( |x|X)?\]\s+(.*)$/;
const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

/**
 * Turns a quick note into blocks. Supports the Markdown-style shortcuts people
 * type in a plain text box: `[] task`, `- [x] done`, `- item`, `1. item`.
 */
export function parseQuickCapture(input: string): QuickCaptureBlock[] {
  const blocks: QuickCaptureBlock[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const todo = TODO.exec(line);
    if (todo) {
      blocks.push({
        flavour: 'affine:list',
        type: 'todo',
        checked: !!todo[1]?.trim(),
        text: todo[2],
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      blocks.push({
        flavour: 'affine:list',
        type: 'bulleted',
        checked: false,
        text: bullet[1],
      });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      blocks.push({
        flavour: 'affine:list',
        type: 'numbered',
        checked: false,
        text: numbered[1],
      });
      continue;
    }
    blocks.push({ flavour: 'affine:paragraph', text: line });
  }
  return blocks;
}

/**
 * Appends a quick note to today's journal without opening it in an editor.
 * Returns the journal doc id.
 */
export async function appendQuickCaptureToJournal(
  workspace: Workspace,
  input: string
): Promise<string | null> {
  const blocks = parseQuickCapture(input);
  if (!blocks.length) return null;

  const journalService = workspace.scope.get(JournalService);
  const docId =
    journalService.journalsByDate$(dayjs().format('YYYY-MM-DD')).value[0]?.id ??
    journalService.ensureJournalByDate(new Date()).id;

  const doc = workspace.docCollection.getDoc(docId);
  if (!doc) throw new Error(`Journal is unavailable: ${docId}`);
  doc.load();
  await workspace.engine.doc.waitForDocLoaded(docId);

  const store = doc.getStore();
  if (store.readonly) throw new Error('Journal is read-only.');
  const page = store.getBlocksByFlavour('affine:page')[0];
  if (!page) throw new Error(`Journal has no page block: ${docId}`);

  const noteId =
    store.getBlocksByFlavour('affine:note')[0]?.id ??
    store.addBlock('affine:note', {}, page.id);
  const note = store.getModelById(noteId);
  if (!note) throw new Error(`Journal has no note block: ${docId}`);
  // A fresh journal starts with one empty paragraph; replace it.
  const only = note.children.length === 1 ? note.children[0] : null;
  if (only?.flavour === 'affine:paragraph' && !only.text?.toString().trim()) {
    store.deleteBlock(only);
  }
  for (const block of blocks) {
    if (block.flavour === 'affine:paragraph') {
      store.addBlock(
        'affine:paragraph',
        { text: new Text(block.text) },
        note.id
      );
    } else {
      store.addBlock(
        'affine:list',
        {
          type: block.type,
          checked: block.checked,
          text: new Text(block.text),
        },
        note.id
      );
    }
  }
  return docId;
}
