import { describe, expect, test } from 'vitest';

import { countWords, readingMinutes } from './word-count';

describe('countWords', () => {
  test('counts latin words and ignores punctuation', () => {
    expect(countWords('Hello, world! It’s a well-known test.')).toBe(6);
  });

  test('counts each CJK character as a word', () => {
    expect(countWords('你好世界 hello')).toBe(5);
  });

  test('returns zero for empty or symbol-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(' — … ')).toBe(0);
  });
});

describe('readingMinutes', () => {
  test('rounds to at least one minute for any text', () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(1150)).toBe(5);
  });
});
