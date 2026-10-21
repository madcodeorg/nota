import { describe, expect, test } from 'vitest';

import { findDueDate, taskGroup } from '..';

describe('findDueDate', () => {
  test('prefers a linked journal date', () => {
    expect(findDueDate('Ship 2026-01-02', ['2026-03-04'])).toBe('2026-03-04');
  });

  test('reads an ISO date from the text', () => {
    expect(findDueDate('Send deck (Due: 2026-05-01)', [undefined])).toBe(
      '2026-05-01'
    );
  });

  test('ignores invalid dates and plain text', () => {
    expect(findDueDate('Fix 2026-13-45 bug', [])).toBeNull();
    expect(findDueDate('Call Sam', [])).toBeNull();
  });
});

describe('taskGroup', () => {
  const today = '2026-05-10';
  test.each([
    [{ checked: true, due: '2026-05-01' }, 'done'],
    [{ checked: false, due: null }, 'someday'],
    [{ checked: false, due: '2026-05-09' }, 'overdue'],
    [{ checked: false, due: '2026-05-10' }, 'today'],
    [{ checked: false, due: '2026-05-11' }, 'upcoming'],
  ] as const)('%o -> %s', (task, group) => {
    expect(taskGroup(task, today)).toBe(group);
  });
});
