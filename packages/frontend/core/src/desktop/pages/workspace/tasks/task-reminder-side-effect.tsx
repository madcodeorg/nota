import {
  loadWorkspaceTasks,
  taskGroup,
  watchTaskDocIds,
} from '@nota/core/modules/tasks';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { firstValueFrom } from 'rxjs';

const REMINDER_HOUR = 9;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;

/**
 * Once a day (from 9:00, while Nota is open) shows a system notification for
 * to-dos that are due today or overdue.
 */
export const TaskReminderSideEffect = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;

  useEffect(() => {
    if (!BUILD_CONFIG.isElectron || typeof Notification === 'undefined') {
      return;
    }
    const storageKey = `nota:task-reminder:${workspace.id}`;
    const abort = new AbortController();
    let running = false;

    const check = async () => {
      const today = dayjs().format('YYYY-MM-DD');
      if (
        running ||
        dayjs().hour() < REMINDER_HOUR ||
        localStorage.getItem(storageKey) === today
      ) {
        return;
      }
      running = true;
      try {
        await workspace.engine.indexer.waitForCompleted(abort.signal);
        const docIds = await firstValueFrom(watchTaskDocIds(workspace));
        const tasks = await loadWorkspaceTasks(workspace, docIds);
        if (abort.signal.aborted) return;
        localStorage.setItem(storageKey, today);
        const due = tasks.filter(task => {
          const group = taskGroup(task, today);
          return group === 'today' || group === 'overdue';
        });
        if (!due.length) return;
        const notification = new Notification(
          due.length === 1 ? '1 task is due' : `${due.length} tasks are due`,
          {
            body: due
              .slice(0, 3)
              .map(task => `• ${task.text}`)
              .join('\n'),
          }
        );
        notification.onclick = () => {
          window.focus();
          workbench.open('/tasks', { at: 'active' });
        };
      } finally {
        running = false;
      }
    };
    const run = () => {
      check().catch(error => {
        if (!abort.signal.aborted) console.error('Task reminder failed', error);
      });
    };

    const firstCheck = setTimeout(run, FIRST_CHECK_DELAY_MS);
    const interval = setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      abort.abort();
      clearTimeout(firstCheck);
      clearInterval(interval);
    };
  }, [workspace, workbench]);

  return null;
};
