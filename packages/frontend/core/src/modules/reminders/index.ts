import dayjs from 'dayjs';
import { map, type Observable, switchMap } from 'rxjs';

import { WorkspaceDBService } from '../db';
import type { Workspace } from '../workspace';

export interface Reminder {
  id: string;
  docId: string;
  /** Unset for a page reminder. */
  blockId?: string;
  /** ms timestamp */
  remindAt: number;
  done?: boolean;
}

export type ReminderTarget = Pick<Reminder, 'docId' | 'blockId'>;

export type ReminderQuickOption =
  'in-1-hour' | 'later-today' | 'tomorrow' | 'next-monday';

export const REMINDER_QUICK_OPTIONS: {
  id: ReminderQuickOption;
  label: string;
}[] = [
  { id: 'in-1-hour', label: 'In 1 hour' },
  { id: 'later-today', label: 'Later today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'next-monday', label: 'Next Monday' },
];

const MORNING_HOUR = 9;
const EVENING_HOUR = 18;
/** Missed reminders beyond this count are shown as one grouped alert. */
const MAX_SEPARATE_MISSED = 2;

export function reminderQuickTime(
  option: ReminderQuickOption,
  now = Date.now()
): number {
  const current = dayjs(now);
  switch (option) {
    case 'in-1-hour':
      return current.add(1, 'hour').valueOf();
    case 'later-today': {
      const evening = current.startOf('day').hour(EVENING_HOUR);
      return evening.isAfter(current)
        ? evening.valueOf()
        : current.add(3, 'hour').valueOf();
    }
    case 'tomorrow':
      return current.startOf('day').add(1, 'day').hour(MORNING_HOUR).valueOf();
    case 'next-monday': {
      const days = (8 - current.day()) % 7 || 7;
      return current
        .startOf('day')
        .add(days, 'day')
        .hour(MORNING_HOUR)
        .valueOf();
    }
  }
}

export function formatReminderTime(remindAt: number, now = Date.now()) {
  const date = dayjs(remindAt);
  const days = date.startOf('day').diff(dayjs(now).startOf('day'), 'day');
  const time = date.format('HH:mm');
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${date.format('ddd')} ${time}`;
  return date.format(
    date.year() === dayjs(now).year() ? `MMM D, ${time}` : `MMM D YYYY, ${time}`
  );
}

/** Open reminders, soonest first. */
export function activeReminders(reminders: Reminder[]) {
  return reminders
    .filter(reminder => !reminder.done)
    .sort((a, b) => a.remindAt - b.remindAt);
}

export function dueReminders(reminders: Reminder[], now = Date.now()) {
  return activeReminders(reminders).filter(
    reminder => reminder.remindAt <= now
  );
}

export function findReminder(reminders: Reminder[], target: ReminderTarget) {
  return activeReminders(reminders).find(
    reminder =>
      reminder.docId === target.docId &&
      (reminder.blockId ?? null) === (target.blockId ?? null)
  );
}

export type ReminderAlert =
  | { type: 'single'; reminder: Reminder; missed: boolean }
  | { type: 'group'; reminders: Reminder[] };

/**
 * Reminders that came due before this session started were missed while Nota
 * was closed. A few of them are shown one by one, more as one group.
 */
export function reminderAlerts(
  due: Reminder[],
  sessionStart: number
): ReminderAlert[] {
  const missed = due.filter(reminder => reminder.remindAt < sessionStart);
  const live = due.filter(reminder => reminder.remindAt >= sessionStart);
  const alerts: ReminderAlert[] =
    missed.length > MAX_SEPARATE_MISSED
      ? [{ type: 'group', reminders: missed }]
      : missed.map(reminder => ({ type: 'single', reminder, missed: true }));
  for (const reminder of live) {
    alerts.push({ type: 'single', reminder, missed: false });
  }
  return alerts;
}

// Reminders are personal, so they live in the signed-in user's data rather
// than in the workspace data other members share.
function remindersTable(workspace: Workspace) {
  return workspace.scope.get(WorkspaceDBService).userdataDB$.value.reminders;
}

function toReminder(row: {
  id: string;
  docId: string;
  blockId?: string | null;
  remindAt: number;
  done?: boolean | null;
}): Reminder {
  return {
    id: row.id,
    docId: row.docId,
    blockId: row.blockId ?? undefined,
    remindAt: row.remindAt,
    done: !!row.done,
  };
}

export function watchReminders(workspace: Workspace): Observable<Reminder[]> {
  return workspace.scope.get(WorkspaceDBService).userdataDB$.pipe(
    switchMap(db => db.reminders.find$()),
    map(rows => rows.map(toReminder))
  );
}

export function getReminders(workspace: Workspace): Reminder[] {
  return remindersTable(workspace).find().map(toReminder);
}

/** A page or block has at most one open reminder; setting it again moves it. */
export function setReminder(
  workspace: Workspace,
  target: ReminderTarget,
  remindAt: number
) {
  const table = remindersTable(workspace);
  const existing = findReminder(getReminders(workspace), target);
  if (existing) {
    table.update(existing.id, { remindAt });
    return existing.id;
  }
  return table.create({
    docId: target.docId,
    blockId: target.blockId,
    remindAt,
    done: false,
  }).id;
}

export function removeReminder(workspace: Workspace, id: string) {
  remindersTable(workspace).delete(id);
}

export function markRemindersDone(workspace: Workspace, ids: string[]) {
  const table = remindersTable(workspace);
  for (const id of ids) table.update(id, { done: true });
}
