import { NotificationIcon } from '@blocksuite/icons/rc';
import {
  DatePicker,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuSub,
  notify,
} from '@nota/component';
import { useService } from '@nota/infra';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';

import { WorkspaceService } from '../../workspace';
import {
  findReminder,
  formatReminderTime,
  type Reminder,
  REMINDER_QUICK_OPTIONS,
  reminderQuickTime,
  removeReminder,
  setReminder,
  watchReminders,
} from '..';
import * as styles from './reminder-menu.css';

export const useReminders = () => {
  const workspace = useService(WorkspaceService).workspace;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  useEffect(() => {
    const subscription = watchReminders(workspace).subscribe(setReminders);
    return () => subscription.unsubscribe();
  }, [workspace]);
  return reminders;
};

const useDocReminder = (docId: string) => {
  const workspace = useService(WorkspaceService).workspace;
  const reminder = findReminder(useReminders(), { docId });
  const set = useCallback(
    (remindAt: number) => {
      setReminder(workspace, { docId }, remindAt);
      notify.success({
        title: 'Reminder set',
        message: formatReminderTime(remindAt),
      });
    },
    [workspace, docId]
  );
  const remove = useCallback(() => {
    if (reminder) removeReminder(workspace, reminder.id);
  }, [workspace, reminder]);
  return { reminder, set, remove };
};

const CustomReminderPicker = ({
  value,
  now,
  onSet,
}: {
  value?: number;
  now: number;
  onSet: (remindAt: number) => void;
}) => {
  const [initial] = useState(() =>
    dayjs(value ?? reminderQuickTime('tomorrow', now))
  );
  const [date, setDate] = useState(initial.format('YYYY-MM-DD'));
  const [time, setTime] = useState(initial.format('HH:mm'));
  const remindAt = dayjs(`${date}T${time}`).valueOf();
  const valid = !Number.isNaN(remindAt) && remindAt > now;

  return (
    <div className={styles.custom} data-testid="reminder-custom-picker">
      <span className={styles.customLabel}>Pick a date and time</span>
      <DatePicker value={date} onChange={setDate} />
      <div className={styles.timeRow}>
        <Input
          type="time"
          className={styles.timeInput}
          value={time}
          onChange={setTime}
          aria-label="Reminder time"
          data-testid="reminder-time-input"
          onKeyDown={event => {
            // Keep typing in the field instead of moving through menu items.
            if (event.key !== 'Escape') event.stopPropagation();
          }}
        />
      </div>
      {valid ? null : (
        <span className={styles.error}>Pick a time in the future</span>
      )}
      <MenuItem
        prefixIcon={<NotificationIcon />}
        disabled={!valid}
        onSelect={() => onSet(remindAt)}
        data-testid="reminder-custom-set"
      >
        Set reminder
      </MenuItem>
    </div>
  );
};

export const ReminderMenuItems = ({
  value,
  onSet,
  onRemove,
}: {
  value?: number;
  onSet: (remindAt: number) => void;
  onRemove?: () => void;
}) => {
  // The menu content mounts when it opens, so this is the time it was opened.
  const [now] = useState(Date.now);
  return (
    <>
      {REMINDER_QUICK_OPTIONS.map(option => {
        const remindAt = reminderQuickTime(option.id, now);
        return (
          <MenuItem
            key={option.id}
            onSelect={() => onSet(remindAt)}
            suffix={
              <span className={styles.quickTime}>
                {formatReminderTime(remindAt, now)}
              </span>
            }
            data-testid={`reminder-quick-${option.id}`}
          >
            {option.label}
          </MenuItem>
        );
      })}
      <MenuSeparator />
      <CustomReminderPicker value={value} now={now} onSet={onSet} />
      {onRemove ? (
        <>
          <MenuSeparator />
          <MenuItem
            type="danger"
            onSelect={onRemove}
            data-testid="reminder-remove"
          >
            Remove reminder
          </MenuItem>
        </>
      ) : null}
    </>
  );
};

/** "Remind me" entry for a page's more menu. */
export const DocReminderMenuSub = ({ docId }: { docId: string }) => {
  const { reminder, set, remove } = useDocReminder(docId);
  return (
    <MenuSub
      triggerOptions={{
        prefixIcon: <NotificationIcon />,
        'data-testid': 'editor-option-menu-reminder',
      }}
      items={
        <ReminderMenuItems
          value={reminder?.remindAt}
          onSet={set}
          onRemove={reminder ? remove : undefined}
        />
      }
    >
      {reminder ? 'Change reminder' : 'Remind me'}
    </MenuSub>
  );
};

/** Bell shown in the doc header while the page has an open reminder. */
export const DocReminderIndicator = ({ docId }: { docId: string }) => {
  const { reminder, set, remove } = useDocReminder(docId);
  if (!reminder) return null;
  const label = formatReminderTime(reminder.remindAt);
  return (
    <Menu
      items={
        <ReminderMenuItems
          value={reminder.remindAt}
          onSet={set}
          onRemove={remove}
        />
      }
    >
      <button
        type="button"
        className={styles.indicator}
        aria-label={`Reminder ${label}. Change or remove it.`}
        data-testid="page-reminder-indicator"
      >
        <NotificationIcon className={styles.indicatorIcon} />
        {label}
      </button>
    </Menu>
  );
};
