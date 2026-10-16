import { describe, expect, test } from 'vitest';

import { splitNoteDrafts } from './note-drafts';

describe('splitNoteDrafts', () => {
  test('keeps plain text as one part', () => {
    expect(splitNoteDrafts('Hello **there**')).toEqual([
      { type: 'text', text: 'Hello **there**' },
    ]);
  });

  test('splits a closed note fence from surrounding text', () => {
    const text =
      'Here is a draft:\n\n```note\n# Title\n\nBody\n```\n\nWant changes?';
    expect(splitNoteDrafts(text)).toEqual([
      { type: 'text', text: 'Here is a draft:\n\n' },
      { type: 'note', text: '# Title\n\nBody' },
      { type: 'text', text: '\n\nWant changes?' },
    ]);
  });

  test('treats an unclosed fence as a draft while streaming', () => {
    expect(splitNoteDrafts('Draft:\n```note\n# Title\nPart')).toEqual([
      { type: 'text', text: 'Draft:\n' },
      { type: 'note', text: '# Title\nPart' },
    ]);
  });

  test('leaves other code fences alone', () => {
    const text = '```ts\nconst a = 1;\n```';
    expect(splitNoteDrafts(text)).toEqual([{ type: 'text', text }]);
  });

  test('treats text after a draft intro line as a draft', () => {
    const text =
      'I could not add it.\n\nHere’s a ready-to-insert draft:\n\n# Title\n\nBody';
    expect(splitNoteDrafts(text)).toEqual([
      {
        type: 'text',
        text: 'I could not add it.\n\nHere’s a ready-to-insert draft:',
      },
      { type: 'note', text: '# Title\n\nBody' },
    ]);
  });

  test('ignores a draft intro with nothing after it', () => {
    const text = 'Here is the draft:';
    expect(splitNoteDrafts(text)).toEqual([{ type: 'text', text }]);
  });

  test('keeps inline mentions of the fence as text', () => {
    const text = 'Use ```note to wrap drafts.';
    expect(splitNoteDrafts(text)).toEqual([{ type: 'text', text }]);
  });
});
