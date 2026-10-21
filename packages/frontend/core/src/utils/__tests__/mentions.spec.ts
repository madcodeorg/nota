import { describe, expect, test } from 'vitest';

import { findMention, isMentionableTitle, mentionSnippet } from '../mentions';

describe('findMention', () => {
  test('matches whole words case-insensitively', () => {
    expect(findMention('We talked about project Atlas today', 'atlas')).toEqual(
      { index: 24, length: 5 }
    );
  });

  test('does not match inside another word', () => {
    expect(findMention('Atlassian rollout', 'Atlas')).toBeNull();
  });

  test('handles regex characters in titles', () => {
    expect(findMention('Notes on C++ (draft) here', 'C++ (draft)')).toEqual({
      index: 9,
      length: 11,
    });
  });

  test('matches CJK titles anywhere', () => {
    expect(findMention('今天的会议记录很重要', '会议记录')).toEqual({
      index: 3,
      length: 4,
    });
  });

  test('ignores short and untitled titles', () => {
    expect(isMentionableTitle('ab')).toBe(false);
    expect(isMentionableTitle('Untitled')).toBe(false);
    expect(findMention('ab ab', 'ab')).toBeNull();
  });
});

test('mentionSnippet trims long content', () => {
  const content = `${'a'.repeat(100)} Atlas ${'b'.repeat(100)}`;
  const snippet = mentionSnippet(content, { index: 101, length: 5 }, 10);
  expect(snippet.match).toBe('Atlas');
  expect(snippet.before.startsWith('…')).toBe(true);
  expect(snippet.after.endsWith('…')).toBe(true);
});
