import { Checkbox, notify } from '@nota/component';
import { NotaPageReference } from '@nota/core/components/affine/reference-link';
import {
  loadWorkspaceTasks,
  setTaskChecked,
  taskGroup,
  type TaskItem,
  watchTaskDocIds,
} from '@nota/core/modules/tasks';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { debounceTime, from, switchMap } from 'rxjs';

import * as styles from './daily-brief.css';

const MAX_TASKS = 8;

type MeetingItem = {
  id: string;
  createdAt: string;
  docId?: string | null;
};

function useWorkspaceTasks() {
  const workspace = useService(WorkspaceService).workspace;
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    const subscription = watchTaskDocIds(workspace)
      .pipe(
        debounceTime(500),
        switchMap(ids => from(loadWorkspaceTasks(workspace, ids)))
      )
      .subscribe({
        next: setTasks,
        error: error => console.error('Failed to load tasks', error),
      });
    return () => subscription.unsubscribe();
  }, [workspace]);

  return [tasks, setTasks] as const;
}

function useMeetingsOn(date: Dayjs) {
  const workspaceId = useService(WorkspaceService).workspace.id;
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const dateKey = date.format('YYYY-MM-DD');

  useEffect(() => {
    let disposed = false;
    const url = new URL(
      `/v1/meetings?${new URLSearchParams({ workspaceId })}`,
      location.href
    );
    fetch(url.toString())
      .then(response => (response.ok ? response.json() : { meetings: [] }))
      .then((data: { meetings?: MeetingItem[] }) => {
        if (disposed) return;
        setMeetings(
          (data.meetings ?? []).filter(
            meeting =>
              meeting.docId &&
              dayjs(meeting.createdAt).format('YYYY-MM-DD') === dateKey
          )
        );
      })
      // Meetings come from the optional local AI backend.
      .catch(() => !disposed && setMeetings([]));
    return () => {
      disposed = true;
    };
  }, [dateKey, workspaceId]);

  return meetings;
}

/**
 * The day at a glance next to a journal: tasks due that day (plus overdue
 * ones when it is today) and meeting notes recorded that day.
 */
export const DailyBrief = ({ date }: { date: Dayjs }) => {
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const [tasks, setTasks] = useWorkspaceTasks();
  const meetings = useMeetingsOn(date);
  const dateKey = date.format('YYYY-MM-DD');
  const isToday = date.isSame(dayjs(), 'day');

  const dueTasks = useMemo(
    () =>
      tasks
        .filter(task => {
          if (task.due === dateKey) return true;
          return isToday && taskGroup(task, dateKey) === 'overdue';
        })
        .sort((a, b) => Number(a.checked) - Number(b.checked)),
    [dateKey, isToday, tasks]
  );

  const onToggle = useCallback(
    (task: TaskItem, checked: boolean) => {
      if (!setTaskChecked(workspace, task, checked)) {
        notify.error({ title: 'This note cannot be edited' });
        return;
      }
      setTasks(prev =>
        prev.map(item =>
          item.docId === task.docId && item.blockId === task.blockId
            ? { ...item, checked }
            : item
        )
      );
    },
    [setTasks, workspace]
  );

  if (!dueTasks.length && !meetings.length) return null;

  return (
    <div className={styles.brief} data-testid="journal-daily-brief">
      {dueTasks.length ? (
        <section>
          <div className={styles.header}>
            <span>{isToday ? 'Due today' : 'Due this day'}</span>
            <button
              className={styles.headerLink}
              type="button"
              onClick={() => workbench.open('/tasks', { at: 'active' })}
            >
              All tasks
            </button>
          </div>
          {dueTasks.slice(0, MAX_TASKS).map(task => (
            <div
              className={styles.task}
              data-checked={task.checked}
              key={`${task.docId}:${task.blockId}`}
            >
              <Checkbox
                checked={task.checked}
                onChange={(_, checked) => onToggle(task, checked)}
              />
              <button
                className={styles.taskText}
                type="button"
                title={task.text}
                onClick={() =>
                  workbench.openDoc(
                    { docId: task.docId, blockIds: [task.blockId] },
                    { at: 'active' }
                  )
                }
              >
                {task.text}
              </button>
              {task.due && task.due < dateKey ? (
                <span className={styles.overdue}>Overdue</span>
              ) : null}
            </div>
          ))}
          {dueTasks.length > MAX_TASKS ? (
            <div className={styles.more}>
              +{dueTasks.length - MAX_TASKS} more
            </div>
          ) : null}
        </section>
      ) : null}
      {meetings.length ? (
        <section>
          <div className={styles.header}>
            <span>Meetings</span>
          </div>
          {meetings.map(meeting => (
            <div className={styles.meeting} key={meeting.id}>
              <span className={styles.meetingTime}>
                {dayjs(meeting.createdAt).format('HH:mm')}
              </span>
              <NotaPageReference pageId={meeting.docId as string} />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
};
