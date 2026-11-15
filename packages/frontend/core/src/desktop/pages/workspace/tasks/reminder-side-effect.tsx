import { NotificationIcon } from '@blocksuite/icons/rc';
import { notify } from '@nota/component';
import { DocsService } from '@nota/core/modules/doc';
import {
  dueReminders,
  formatReminderTime,
  getReminders,
  markRemindersDone,
  type Reminder,
  type ReminderAlert,
  reminderAlerts,
} from '@nota/core/modules/reminders';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import { useEffect } from 'react';

import * as styles from './reminder-side-effect.css';

const CHECK_INTERVAL_MS = 30 * 1000;
/** Lets the workspace DB and doc list load before missed reminders fire. */
const FIRST_CHECK_DELAY_MS = 5 * 1000;

/**
 * While Nota is open, shows due page and block reminders as an in-app
 * notification and, in the desktop app, a system notification.
 */
export const ReminderSideEffect = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const docsService = useService(DocsService);

  useEffect(() => {
    const sessionStart = Date.now();
    const canNotifySystem =
      BUILD_CONFIG.isElectron && typeof Notification !== 'undefined';

    const title = (reminder: Reminder) =>
      docsService.list.doc$(reminder.docId).value?.title$.value || 'Untitled';

    const blockText = (reminder: Reminder) => {
      if (!reminder.blockId) return null;
      const model = workspace.docCollection
        .getDoc(reminder.docId)
        ?.getStore()
        .getModelById(reminder.blockId);
      return model?.text?.toString().trim() || null;
    };

    const open = (reminder: Reminder) => {
      window.focus();
      workbench.openDoc(
        {
          docId: reminder.docId,
          blockIds: reminder.blockId ? [reminder.blockId] : undefined,
        },
        { at: 'active' }
      );
    };

    const show = (alert: ReminderAlert) => {
      if (alert.type === 'group') {
        const count = alert.reminders.length;
        notify(
          {
            icon: <NotificationIcon />,
            title: `You missed ${count} reminders`,
            message: (
              <div className={styles.reminderLinks}>
                {alert.reminders.map(reminder => (
                  <button
                    key={reminder.id}
                    type="button"
                    className={styles.reminderLink}
                    onClick={() => open(reminder)}
                  >
                    {title(reminder)}
                  </button>
                ))}
              </div>
            ),
          },
          { duration: Infinity }
        );
        if (canNotifySystem) {
          const notification = new Notification(
            `You missed ${count} reminders`,
            {
              body: alert.reminders
                .slice(0, 3)
                .map(reminder => `• ${title(reminder)}`)
                .join('\n'),
            }
          );
          notification.onclick = () => window.focus();
        }
        return;
      }

      const { reminder, missed } = alert;
      const heading = title(reminder);
      const time = formatReminderTime(reminder.remindAt);
      const body = [
        blockText(reminder),
        missed ? `Missed reminder · ${time}` : `Reminder · ${time}`,
      ]
        .filter(Boolean)
        .join(' · ');
      notify(
        {
          icon: <NotificationIcon />,
          title: heading,
          message: body,
          actions: [
            { key: 'open', label: 'Open', onClick: () => open(reminder) },
          ],
        },
        { duration: Infinity }
      );
      if (canNotifySystem) {
        const notification = new Notification(heading, { body });
        notification.onclick = () => open(reminder);
      }
    };

    const check = () => {
      const due = dueReminders(getReminders(workspace));
      if (!due.length) return;
      // Mark first, so a failing alert cannot fire again on every check.
      markRemindersDone(
        workspace,
        due.map(reminder => reminder.id)
      );
      const visible = due.filter(
        reminder => !docsService.list.doc$(reminder.docId).value?.trash$.value
      );
      for (const alert of reminderAlerts(visible, sessionStart)) show(alert);
    };
    const run = () => {
      try {
        check();
      } catch (error) {
        console.error('Reminder check failed', error);
      }
    };

    const firstCheck = setTimeout(run, FIRST_CHECK_DELAY_MS);
    const interval = setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(firstCheck);
      clearInterval(interval);
    };
  }, [workspace, workbench, docsService]);

  return null;
};
