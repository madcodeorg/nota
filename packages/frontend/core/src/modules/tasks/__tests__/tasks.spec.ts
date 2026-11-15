import type { Store } from '@blocksuite/affine/store';
import { describe, expect, test } from 'vitest';

import {
  findDueDate,
  readDocTasks,
  taskBoardColumn,
  taskGroup,
  taskKey,
} from '..';

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

describe('taskBoardColumn', () => {
  test('checked tasks are done whatever the stored status', () => {
    expect(taskBoardColumn({ checked: true }, 'doing')).toBe('done');
  });

  test('open tasks are in progress only when marked', () => {
    expect(taskBoardColumn({ checked: false }, 'doing')).toBe('doing');
    expect(taskBoardColumn({ checked: false }, undefined)).toBe('todo');
  });

  test('keys a task by note and block', () => {
    expect(taskKey({ docId: 'doc', blockId: 'block' })).toBe('doc:block');
  });
});

describe('readDocTasks', () => {
  test('uses a linked journal as the due date, not as task text', () => {
    const store = {
      getBlocksByFlavour: () => [
        {
          model: {
            id: 'block',
            props: {
              type: 'todo',
              checked: false,
              text: {
                toDelta: () => [
                  { insert: 'Call ' },
                  { insert: ' ', attributes: { reference: { pageId: 'sam' } } },
                  { insert: ' ' },
                  {
                    insert: ' ',
                    attributes: { reference: { pageId: 'journal' } },
                  },
                ],
              },
            },
          },
        },
      ],
    } as unknown as Store;
    const tasks = readDocTasks(store, 'doc', {
      journalDate: id => (id === 'journal' ? '2026-05-11' : undefined),
      title: id => (id === 'sam' ? 'Sam' : '2026-05-11'),
    });
    expect(tasks).toEqual([
      {
        docId: 'doc',
        blockId: 'block',
        text: 'Call Sam',
        checked: false,
        due: '2026-05-11',
      },
    ]);
  });
});
