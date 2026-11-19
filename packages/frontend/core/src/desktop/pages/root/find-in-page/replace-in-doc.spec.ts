import { describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';

import {
  findMatchesInText,
  findTextMatchesInDoc,
  replaceAllInDoc,
  replaceMatchInDoc,
} from './replace-in-doc';

function createFakeDoc(
  blocksSpec: Array<{
    id: string;
    flavour: string;
    text?: string;
    boldRange?: [number, number];
  }>,
  options?: { readonly?: boolean }
) {
  const ydoc = new Y.Doc();
  const byId = new Map<string, any>();
  const children: any[] = [];

  for (const spec of blocksSpec) {
    const yText =
      spec.text !== undefined ? ydoc.getText(`text-${spec.id}`) : undefined;
    if (yText && spec.text) {
      yText.insert(0, spec.text);
      if (spec.boldRange) {
        yText.format(spec.boldRange[0], spec.boldRange[1] - spec.boldRange[0], {
          bold: true,
        });
      }
    }
    const model = {
      id: spec.id,
      flavour: spec.flavour,
      children: [],
      text: yText ? { yText } : undefined,
    };
    byId.set(spec.id, model);
    children.push(model);
  }

  const root = {
    id: 'page-root',
    flavour: 'affine:page',
    text: { yText: ydoc.getText('page-title') },
    children,
  };
  root.text.yText.insert(0, 'Note title with foo');
  byId.set(root.id, root);

  const captureSync = vi.fn();
  const doc = {
    readonly: !!options?.readonly,
    root,
    captureSync,
    transact: (fn: () => void) => ydoc.transact(fn),
    getBlock: (id: string) => {
      const model = byId.get(id);
      return model ? { model } : undefined;
    },
  };

  return { doc: doc as any, byId, captureSync, root };
}

describe('replace-in-doc', () => {
  test('finds non-overlapping matches with optional case sensitivity', () => {
    expect(findMatchesInText('aaa', 'aa')).toEqual([{ index: 0, length: 2 }]);
    expect(findMatchesInText('Foo foo FOO', 'foo')).toHaveLength(3);
    expect(
      findMatchesInText('Foo foo FOO', 'foo', { caseSensitive: true })
    ).toEqual([{ index: 4, length: 3 }]);
  });

  test('skips page title and replaces one targeted occurrence while preserving inline attributes', () => {
    const { doc, byId, captureSync, root } = createFakeDoc([
      {
        id: 'b1',
        flavour: 'affine:paragraph',
        text: 'Hello foo and FOO',
        boldRange: [6, 9],
      },
      {
        id: 'b2',
        flavour: 'affine:list',
        text: 'Second foo item',
      },
    ]);

    expect(findTextMatchesInDoc(doc, 'foo')).toHaveLength(3);

    const res = replaceMatchInDoc(doc, 'foo', 'bar', { occurrenceIndex: 0 });
    expect(res).toEqual({ replaced: true, remaining: 2 });
    expect(captureSync).toHaveBeenCalledTimes(1);
    expect(byId.get('b1').text.yText.toString()).toBe('Hello bar and FOO');
    expect(byId.get('b1').text.yText.toDelta()).toEqual([
      { insert: 'Hello ' },
      { insert: 'bar', attributes: { bold: true } },
      { insert: ' and FOO' },
    ]);
    // Page title was untouched.
    expect(root.text.yText.toString()).toBe('Note title with foo');
  });

  test('replaces all matches across multiple blocks in a single undoable transaction', () => {
    const { doc, byId, captureSync } = createFakeDoc([
      { id: 'b1', flavour: 'affine:paragraph', text: 'foo one foo' },
      { id: 'b2', flavour: 'affine:list', text: 'FOO two' },
    ]);

    const res = replaceAllInDoc(doc, 'foo', 'nota');
    expect(res).toEqual({ replacedCount: 3, blocksTouched: 2 });
    expect(captureSync).toHaveBeenCalledTimes(1);
    expect(byId.get('b1').text.yText.toString()).toBe('nota one nota');
    expect(byId.get('b2').text.yText.toString()).toBe('nota two');
  });

  test('respects case sensitivity and refuses edits on readonly/locked docs', () => {
    const { doc, byId } = createFakeDoc([
      { id: 'b1', flavour: 'affine:paragraph', text: 'Foo foo' },
    ]);
    const res = replaceAllInDoc(doc, 'foo', 'bar', { caseSensitive: true });
    expect(res).toEqual({ replacedCount: 1, blocksTouched: 1 });
    expect(byId.get('b1').text.yText.toString()).toBe('Foo bar');

    const locked = createFakeDoc(
      [{ id: 'b1', flavour: 'affine:paragraph', text: 'foo' }],
      { readonly: true }
    );
    expect(replaceMatchInDoc(locked.doc, 'foo', 'bar')).toEqual({
      replaced: false,
      remaining: 0,
    });
    expect(replaceAllInDoc(locked.doc, 'foo', 'bar')).toEqual({
      replacedCount: 0,
      blocksTouched: 0,
    });
    expect(locked.byId.get('b1').text.yText.toString()).toBe('foo');
  });
});
