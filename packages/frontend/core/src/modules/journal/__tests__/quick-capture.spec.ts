import { describe, expect, test } from 'vitest';

import { parseQuickCapture } from '../quick-capture';

describe('parseQuickCapture', () => {
  test('keeps plain lines as paragraphs and skips blank lines', () => {
    expect(parseQuickCapture('first idea\n\n  second idea  ')).toEqual([
      { flavour: 'affine:paragraph', text: 'first idea' },
      { flavour: 'affine:paragraph', text: 'second idea' },
    ]);
  });

  test('turns task shortcuts into todo items', () => {
    expect(
      parseQuickCapture('[] call Sam\n- [ ] book room\n- [x] sent')
    ).toEqual([
      {
        flavour: 'affine:list',
        type: 'todo',
        checked: false,
        text: 'call Sam',
      },
      {
        flavour: 'affine:list',
        type: 'todo',
        checked: false,
        text: 'book room',
      },
      { flavour: 'affine:list', type: 'todo', checked: true, text: 'sent' },
    ]);
  });

  test('recognises bulleted and numbered lists', () => {
    expect(parseQuickCapture('- milk\n* eggs\n1. first\n2) second')).toEqual([
      {
        flavour: 'affine:list',
        type: 'bulleted',
        checked: false,
        text: 'milk',
      },
      {
        flavour: 'affine:list',
        type: 'bulleted',
        checked: false,
        text: 'eggs',
      },
      {
        flavour: 'affine:list',
        type: 'numbered',
        checked: false,
        text: 'first',
      },
      {
        flavour: 'affine:list',
        type: 'numbered',
        checked: false,
        text: 'second',
      },
    ]);
  });
});
