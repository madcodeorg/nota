import dayjs from 'dayjs';
import { describe, expect, test } from 'vitest';

import {
  dueReminders,
  findReminder,
  formatReminderTime,
  type Reminder,
  reminderAlerts,
  reminderQuickTime,
} from '..';

const at = (value: string) => dayjs(value).valueOf();

describe('reminderQuickTime', () => {
  // 2026-05-13 is a Wednesday.
  const morning = at('2026-05-13T10:15:00');
  const night = at('2026-05-13T19:30:00');

  test('in 1 hour', () => {
    expect(reminderQuickTime('in-1-hour', morning)).toBe(
      at('2026-05-13T11:15:00')
    );
  });

  test('later today is 18:00, or 3 hours from now after that', () => {
    expect(reminderQuickTime('later-today', morning)).toBe(
      at('2026-05-13T18:00:00')
    );
    expect(reminderQuickTime('later-today', night)).toBe(
      at('2026-05-13T22:30:00')
    );
    expect(reminderQuickTime('later-today', at('2026-05-13T18:00:00'))).toBe(
      at('2026-05-13T21:00:00')
    );
  });

  test('tomorrow at 9:00', () => {
    expect(reminderQuickTime('tomorrow', night)).toBe(
      at('2026-05-14T09:00:00')
    );
  });

  test('next Monday at 9:00, a week ahead on a Monday', () => {
    expect(reminderQuickTime('next-monday', morning)).toBe(
      at('2026-05-18T09:00:00')
    );
    expect(reminderQuickTime('next-monday', at('2026-05-17T23:00:00'))).toBe(
      at('2026-05-18T09:00:00')
    );
    expect(reminderQuickTime('next-monday', at('2026-05-18T08:00:00'))).toBe(
      at('2026-05-25T09:00:00')
    );
  });
});

describe('formatReminderTime', () => {
  const now = at('2026-05-13T10:00:00');
  test.each([
    ['2026-05-13T18:00:00', 'Today 18:00'],
    ['2026-05-14T09:00:00', 'Tomorrow 09:00'],
    ['2026-05-18T09:00:00', 'Mon 09:00'],
    ['2026-06-02T07:05:00', 'Jun 2, 07:05'],
    ['2027-01-02T07:05:00', 'Jan 2 2027, 07:05'],
  ])('%s -> %s', (value, label) => {
    expect(formatReminderTime(at(value), now)).toBe(label);
  });
});

const reminder = (
  id: string,
  remindAt: number,
  extra: Partial<Reminder> = {}
): Reminder => ({ id, docId: 'doc', remindAt, ...extra });

describe('dueReminders', () => {
  test('returns open reminders that are due, soonest first', () => {
    const now = 1000;
    const due = dueReminders(
      [
        reminder('later', 2000),
        reminder('b', 900),
        reminder('done', 100, { done: true }),
        reminder('a', 100),
        reminder('now', 1000),
      ],
      now
    );
    expect(due.map(item => item.id)).toEqual(['a', 'b', 'now']);
  });
});

describe('findReminder', () => {
  const reminders = [
    reminder('page', 300),
    reminder('block', 200, { blockId: 'b1' }),
    reminder('old', 100, { done: true }),
  ];

  test('tells page and block reminders apart', () => {
    expect(findReminder(reminders, { docId: 'doc' })?.id).toBe('page');
    expect(findReminder(reminders, { docId: 'doc', blockId: 'b1' })?.id).toBe(
      'block'
    );
    expect(
      findReminder(reminders, { docId: 'doc', blockId: 'b2' })
    ).toBeUndefined();
    expect(findReminder(reminders, { docId: 'other' })).toBeUndefined();
  });
});

describe('reminderAlerts', () => {
  const start = 1000;

  test('reminders due during the session alert one by one', () => {
    expect(
      reminderAlerts([reminder('a', 1000), reminder('b', 1500)], start)
    ).toEqual([
      { type: 'single', reminder: reminder('a', 1000), missed: false },
      { type: 'single', reminder: reminder('b', 1500), missed: false },
    ]);
  });

  test('a few missed reminders alert one by one', () => {
    expect(
      reminderAlerts([reminder('a', 100), reminder('b', 200)], start)
    ).toEqual([
      { type: 'single', reminder: reminder('a', 100), missed: true },
      { type: 'single', reminder: reminder('b', 200), missed: true },
    ]);
  });

  test('many missed reminders are grouped, live ones stay separate', () => {
    const missed = [reminder('a', 100), reminder('b', 200), reminder('c', 300)];
    expect(reminderAlerts([...missed, reminder('d', 1200)], start)).toEqual([
      { type: 'group', reminders: missed },
      { type: 'single', reminder: reminder('d', 1200), missed: false },
    ]);
  });

  test('nothing due, nothing to show', () => {
    expect(reminderAlerts([], start)).toEqual([]);
  });
});
