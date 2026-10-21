import { Checkbox, notify } from '@nota/component';
import { DocsService } from '@nota/core/modules/doc';
import {
  loadWorkspaceTasks,
  setTaskChecked,
  type TaskGroup,
  taskGroup,
  type TaskItem,
  watchTaskDocIds,
} from '@nota/core/modules/tasks';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { debounceTime, from, switchMap } from 'rxjs';

import * as styles from './index.css';

const GROUPS: { id: TaskGroup; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'someday', label: 'No date' },
  { id: 'done', label: 'Completed' },
];

const MAX_DONE = 50;

function formatDue(due: string, today: string) {
  const offset = dayjs(due).diff(dayjs(today), 'day');
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  const date = dayjs(due);
  return date.format(date.year() === dayjs().year() ? 'MMM D' : 'MMM D, YYYY');
}

const TaskRow = ({
  task,
  group,
  today,
  onToggle,
  onOpen,
}: {
  task: TaskItem;
  group: TaskGroup;
  today: string;
  onToggle: (task: TaskItem, checked: boolean) => void;
  onOpen: (task: TaskItem) => void;
}) => {
  const docsService = useService(DocsService);
  const docTitle =
    docsService.list.doc$(task.docId).value?.title$.value || 'Untitled';
  return (
    <div className={styles.row} data-checked={task.checked}>
      <Checkbox
        checked={task.checked}
        animation
        aria-label={task.checked ? 'Mark as not done' : 'Mark as done'}
        onChange={(_, checked) => onToggle(task, checked)}
      />
      <button
        className={styles.rowMain}
        type="button"
        onClick={() => onOpen(task)}
      >
        <span className={styles.rowText}>{task.text}</span>
        <span className={styles.rowSource}>{docTitle}</span>
      </button>
      {task.due ? (
        <span className={styles.due} data-overdue={group === 'overdue'}>
          {formatDue(task.due, today)}
        </span>
      ) : null}
    </div>
  );
};

export const TasksPage = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');

  useEffect(() => {
    const subscription = watchTaskDocIds(workspace)
      .pipe(
        debounceTime(300),
        switchMap(ids => from(loadWorkspaceTasks(workspace, ids)))
      )
      .subscribe({
        next: setTasks,
        error: error => {
          console.error('Failed to load tasks', error);
          setTasks([]);
        },
      });
    return () => subscription.unsubscribe();
  }, [workspace]);

  const grouped = useMemo(() => {
    const result = new Map<TaskGroup, TaskItem[]>(
      GROUPS.map(group => [group.id, []])
    );
    for (const task of tasks ?? []) {
      result.get(taskGroup(task, today))?.push(task);
    }
    for (const id of ['overdue', 'today', 'upcoming'] as const) {
      result.get(id)?.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
    }
    return result;
  }, [tasks, today]);

  const onToggle = useCallback(
    (task: TaskItem, checked: boolean) => {
      if (!setTaskChecked(workspace, task, checked)) {
        notify.error({ title: 'This note cannot be edited' });
        return;
      }
      setTasks(prev =>
        (prev ?? []).map(item =>
          item.docId === task.docId && item.blockId === task.blockId
            ? { ...item, checked }
            : item
        )
      );
    },
    [workspace]
  );

  const onOpen = useCallback(
    (task: TaskItem) => {
      workbench.openDoc(
        { docId: task.docId, blockIds: [task.blockId] },
        { at: 'active' }
      );
    },
    [workbench]
  );

  const openCount = (tasks ?? []).filter(task => !task.checked).length;

  return (
    <>
      <ViewTitle title="Tasks" />
      <ViewIcon icon="tasks" />
      <ViewBody>
        <div className={styles.body}>
          <div className={styles.content}>
            <header className={styles.header}>
              <h1 className={styles.title}>Tasks</h1>
              <p className={styles.subtitle}>
                {tasks === null
                  ? 'Collecting to-dos from your notes…'
                  : `${openCount} open across your notes. Give a to-do a date with @ (for example @Tomorrow) or by typing YYYY-MM-DD.`}
              </p>
            </header>
            {tasks !== null && tasks.length === 0 ? (
              <div className={styles.empty}>
                No to-dos yet. Type <code>[]</code> followed by a space in any
                note to add one.
              </div>
            ) : null}
            {GROUPS.map(group => {
              const items = grouped.get(group.id) ?? [];
              if (!items.length) return null;
              const isDone = group.id === 'done';
              return (
                <section
                  className={styles.group}
                  key={group.id}
                  data-testid={`tasks-group-${group.id}`}
                >
                  <div className={styles.groupHeader}>
                    {isDone ? (
                      <button
                        className={styles.groupToggle}
                        type="button"
                        onClick={() => setShowDone(value => !value)}
                      >
                        {showDone ? 'Hide completed' : 'Show completed'}
                      </button>
                    ) : (
                      <span
                        className={styles.groupLabel}
                        data-overdue={group.id === 'overdue'}
                      >
                        {group.label}
                      </span>
                    )}
                    <span className={styles.groupCount}>{items.length}</span>
                  </div>
                  {!isDone || showDone
                    ? (isDone ? items.slice(0, MAX_DONE) : items).map(task => (
                        <TaskRow
                          key={`${task.docId}:${task.blockId}`}
                          task={task}
                          group={group.id}
                          today={today}
                          onToggle={onToggle}
                          onOpen={onOpen}
                        />
                      ))
                    : null}
                </section>
              );
            })}
          </div>
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <TasksPage />;
};
