import {
  CloseIcon,
  DateTimeIcon,
  MoreHorizontalIcon,
  NotificationIcon,
  PlusIcon,
} from '@blocksuite/icons/rc';
import {
  Button,
  Checkbox,
  DatePicker,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  notify,
  RadioGroup,
} from '@nota/component';
import { DocsService } from '@nota/core/modules/doc';
import {
  activeReminders,
  formatReminderTime,
  type Reminder,
  removeReminder,
} from '@nota/core/modules/reminders';
import { useReminders } from '@nota/core/modules/reminders/views/reminder-menu';
import {
  addTask,
  loadWorkspaceTasks,
  moveTaskOnBoard,
  setTaskChecked,
  type TaskBoardColumn,
  taskBoardColumn,
  type TaskGroup,
  taskGroup,
  type TaskItem,
  taskKey,
  watchTaskBoardStatus,
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
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { debounceTime, from, switchMap } from 'rxjs';

import * as styles from './index.css';

const GROUPS: { id: TaskGroup; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'someday', label: 'No date' },
  { id: 'done', label: 'Completed' },
];

const COLUMNS: { id: TaskBoardColumn; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

const MAX_DONE = 50;
const VIEW_STORAGE_KEY = 'nota:tasks-view';
const DRAG_TYPE = 'application/x-nota-task';

type TasksView = 'list' | 'board';
type AddTaskInput = { text: string; due: string | null };

function formatDue(due: string, today: string) {
  const offset = dayjs(due).diff(dayjs(today), 'day');
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  const date = dayjs(due);
  return date.format(date.year() === dayjs().year() ? 'MMM D' : 'MMM D, YYYY');
}

function sortByDue(tasks: TaskItem[]) {
  return tasks.sort((a, b) => {
    if (!a.due) return b.due ? 1 : 0;
    if (!b.due) return -1;
    return a.due.localeCompare(b.due);
  });
}

const DueChip = ({ due, today }: { due: string; today: string }) => {
  const group = taskGroup({ checked: false, due }, today);
  return (
    <span
      className={styles.due}
      data-overdue={group === 'overdue'}
      data-today={group === 'today'}
    >
      {formatDue(due, today)}
    </span>
  );
};

const DuePicker = ({
  value,
  today,
  compact,
  onChange,
}: {
  value: string | null;
  today: string;
  compact?: boolean;
  onChange: (value: string | null) => void;
}) => {
  const [open, setOpen] = useState(false);
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Menu
      rootOptions={{ open, onOpenChange: setOpen }}
      items={
        <>
          <MenuItem onSelect={() => pick(today)}>Today</MenuItem>
          <MenuItem
            onSelect={() =>
              pick(dayjs(today).add(1, 'day').format('YYYY-MM-DD'))
            }
          >
            Tomorrow
          </MenuItem>
          <MenuItem
            onSelect={() =>
              pick(dayjs(today).add(1, 'week').format('YYYY-MM-DD'))
            }
          >
            Next week
          </MenuItem>
          {value ? (
            <MenuItem type="danger" onSelect={() => pick(null)}>
              Remove date
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <DatePicker value={value ?? undefined} onChange={pick} />
        </>
      }
    >
      <Button
        variant="plain"
        prefix={<DateTimeIcon />}
        className={styles.dueButton}
        data-active={!!value}
        aria-label="Set a due date"
      >
        {value ? formatDue(value, today) : compact ? null : 'Due date'}
      </Button>
    </Menu>
  );
};

const TaskComposer = ({
  today,
  placeholder = 'Add a task…',
  autoFocus,
  onAdd,
  onCancel,
  testId,
  compact,
}: {
  today: string;
  placeholder?: string;
  autoFocus?: boolean;
  onAdd: (input: AddTaskInput) => Promise<boolean>;
  onCancel?: () => void;
  testId?: string;
  compact?: boolean;
}) => {
  const [text, setText] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      if (await onAdd({ text, due })) {
        setText('');
        setDue(null);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.composer} data-testid={testId}>
      <Input
        className={styles.composerInput}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        noBorder
        onChange={setText}
        onEnter={() => {
          submit().catch(console.error);
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') onCancel?.();
        }}
      />
      <div className={styles.composerActions}>
        <DuePicker
          value={due}
          today={today}
          compact={compact}
          onChange={setDue}
        />
        <span className={styles.composerSpacer} />
        {onCancel ? (
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={!text.trim()}
          loading={saving}
          onClick={() => {
            submit().catch(console.error);
          }}
        >
          {compact ? 'Add' : 'Add task'}
        </Button>
      </div>
    </div>
  );
};

const useDocTitle = (docId: string) => {
  const docsService = useService(DocsService);
  return docsService.list.doc$(docId).value?.title$.value || 'Untitled';
};

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
  const docTitle = useDocTitle(task.docId);
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
      {task.due && group !== 'done' ? (
        <DueChip due={task.due} today={today} />
      ) : null}
    </div>
  );
};

const ReminderRow = ({
  reminder,
  onOpen,
  onRemove,
}: {
  reminder: Reminder;
  onOpen: (reminder: Reminder) => void;
  onRemove: (reminder: Reminder) => void;
}) => {
  const docTitle = useDocTitle(reminder.docId);
  return (
    <div className={styles.row} data-testid="tasks-reminder-row">
      <NotificationIcon className={styles.reminderIcon} />
      <button
        className={styles.rowMain}
        type="button"
        onClick={() => onOpen(reminder)}
      >
        <span className={styles.rowText}>{docTitle}</span>
        <span className={styles.rowSource}>
          {reminder.blockId ? 'Block reminder' : 'Page reminder'}
        </span>
      </button>
      <span className={styles.due}>
        {formatReminderTime(reminder.remindAt)}
      </span>
      <IconButton
        size="16"
        icon={<CloseIcon />}
        aria-label="Remove reminder"
        onClick={() => onRemove(reminder)}
      />
    </div>
  );
};

const TaskCard = ({
  task,
  column,
  today,
  onMove,
  onOpen,
}: {
  task: TaskItem;
  column: TaskBoardColumn;
  today: string;
  onMove: (task: TaskItem, column: TaskBoardColumn) => void;
  onOpen: (task: TaskItem) => void;
}) => {
  const docTitle = useDocTitle(task.docId);
  return (
    <div
      className={styles.card}
      data-checked={task.checked}
      data-testid="tasks-board-card"
      draggable
      onDragStart={event => {
        event.dataTransfer.setData(DRAG_TYPE, taskKey(task));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className={styles.cardTop}>
        <Checkbox
          checked={task.checked}
          animation
          aria-label={task.checked ? 'Mark as not done' : 'Mark as done'}
          onChange={(_, checked) => onMove(task, checked ? 'done' : 'todo')}
        />
        <button
          className={styles.cardText}
          type="button"
          onClick={() => onOpen(task)}
        >
          {task.text}
        </button>
        <Menu
          items={
            <>
              {COLUMNS.filter(item => item.id !== column).map(item => (
                <MenuItem key={item.id} onSelect={() => onMove(task, item.id)}>
                  Move to {item.label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => onOpen(task)}>Open note</MenuItem>
            </>
          }
        >
          <IconButton
            className={styles.cardMenu}
            size="16"
            icon={<MoreHorizontalIcon />}
            aria-label="Task actions"
          />
        </Menu>
      </div>
      <div className={styles.cardMeta}>
        <span className={styles.cardSource}>{docTitle}</span>
        {task.due && column !== 'done' ? (
          <DueChip due={task.due} today={today} />
        ) : null}
      </div>
    </div>
  );
};

const BoardColumn = ({
  column,
  label,
  tasks,
  today,
  onMove,
  onOpen,
  onAdd,
  onDropTask,
}: {
  column: TaskBoardColumn;
  label: string;
  tasks: TaskItem[];
  today: string;
  onMove: (task: TaskItem, column: TaskBoardColumn) => void;
  onOpen: (task: TaskItem) => void;
  onAdd: (input: AddTaskInput, column: TaskBoardColumn) => Promise<boolean>;
  onDropTask: (key: string, column: TaskBoardColumn) => void;
}) => {
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const visible = column === 'done' ? tasks.slice(0, MAX_DONE) : tasks;

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };
  const onDrop = (event: DragEvent) => {
    setDragOver(false);
    const key = event.dataTransfer.getData(DRAG_TYPE);
    if (!key) return;
    event.preventDefault();
    onDropTask(key, column);
  };

  return (
    <section
      className={styles.column}
      data-drag-over={dragOver}
      data-testid={`tasks-board-${column}`}
      onDragOver={onDragOver}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={onDrop}
    >
      <header className={styles.columnHeader}>
        <span className={styles.columnDot} data-column={column} />
        <span className={styles.columnLabel}>{label}</span>
        <span className={styles.groupCount}>{tasks.length}</span>
        <span className={styles.composerSpacer} />
        <IconButton
          size="16"
          icon={<PlusIcon />}
          aria-label={`Add a task to ${label}`}
          onClick={() => setAdding(true)}
        />
      </header>
      <div className={styles.columnCards}>
        {adding ? (
          <TaskComposer
            today={today}
            autoFocus
            placeholder="What needs doing?"
            compact
            onAdd={input => onAdd(input, column)}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {visible.map(task => (
          <TaskCard
            key={taskKey(task)}
            task={task}
            column={column}
            today={today}
            onMove={onMove}
            onOpen={onOpen}
          />
        ))}
        {!adding ? (
          <button
            className={styles.columnAdd}
            type="button"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            Add task
          </button>
        ) : null}
      </div>
    </section>
  );
};

export const TasksPage = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [statuses, setStatuses] = useState<Map<string, string>>(new Map());
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<TasksView>(() =>
    localStorage.getItem(VIEW_STORAGE_KEY) === 'board' ? 'board' : 'list'
  );
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

  useEffect(() => {
    const subscription = watchTaskBoardStatus(workspace).subscribe(setStatuses);
    return () => subscription.unsubscribe();
  }, [workspace]);

  const onViewChange = useCallback((next: TasksView) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }, []);

  const grouped = useMemo(() => {
    const result = new Map<TaskGroup, TaskItem[]>(
      GROUPS.map(group => [group.id, []])
    );
    for (const task of tasks ?? []) {
      result.get(taskGroup(task, today))?.push(task);
    }
    for (const id of ['overdue', 'today', 'upcoming'] as const) {
      sortByDue(result.get(id) ?? []);
    }
    return result;
  }, [tasks, today]);

  const columns = useMemo(() => {
    const result = new Map<TaskBoardColumn, TaskItem[]>(
      COLUMNS.map(column => [column.id, []])
    );
    for (const task of tasks ?? []) {
      result
        .get(taskBoardColumn(task, statuses.get(taskKey(task))))
        ?.push(task);
    }
    sortByDue(result.get('todo') ?? []);
    sortByDue(result.get('doing') ?? []);
    return result;
  }, [tasks, statuses]);

  const updateChecked = useCallback((task: TaskItem, checked: boolean) => {
    setTasks(prev =>
      (prev ?? []).map(item =>
        item.docId === task.docId && item.blockId === task.blockId
          ? { ...item, checked }
          : item
      )
    );
  }, []);

  const onToggle = useCallback(
    (task: TaskItem, checked: boolean) => {
      if (!setTaskChecked(workspace, task, checked)) {
        notify.error({ title: 'This note cannot be edited' });
        return;
      }
      updateChecked(task, checked);
    },
    [workspace, updateChecked]
  );

  const onMove = useCallback(
    (task: TaskItem, column: TaskBoardColumn) => {
      if (!moveTaskOnBoard(workspace, task, column)) {
        notify.error({ title: 'This note cannot be edited' });
        return;
      }
      updateChecked(task, column === 'done');
    },
    [workspace, updateChecked]
  );

  const onDropTask = useCallback(
    (key: string, column: TaskBoardColumn) => {
      const task = tasks?.find(item => taskKey(item) === key);
      if (task) onMove(task, column);
    },
    [tasks, onMove]
  );

  const onAdd = useCallback(
    async (input: AddTaskInput, column: TaskBoardColumn = 'todo') => {
      try {
        const task = await addTask(workspace, {
          ...input,
          checked: column === 'done',
        });
        if (column === 'doing') moveTaskOnBoard(workspace, task, 'doing');
        setTasks(prev => [...(prev ?? []), task]);
        return true;
      } catch (error) {
        console.error('Failed to add task', error);
        notify.error({
          title: 'Could not add the task',
          message: error instanceof Error ? error.message : undefined,
        });
        return false;
      }
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

  const reminders = activeReminders(useReminders());
  const onOpenReminder = useCallback(
    (reminder: Reminder) => {
      workbench.openDoc(
        {
          docId: reminder.docId,
          blockIds: reminder.blockId ? [reminder.blockId] : undefined,
        },
        { at: 'active' }
      );
    },
    [workbench]
  );
  const onRemoveReminder = useCallback(
    (reminder: Reminder) => removeReminder(workspace, reminder.id),
    [workspace]
  );

  return (
    <>
      <ViewTitle title="Tasks" />
      <ViewIcon icon="tasks" />
      <ViewBody>
        <div className={styles.body}>
          <div className={styles.content} data-view={view}>
            <header className={styles.header}>
              <div className={styles.headerText}>
                <h1 className={styles.title}>Tasks</h1>
                <p className={styles.subtitle}>
                  {tasks === null
                    ? 'Collecting to-dos from your notes…'
                    : `${openCount} open. Add tasks here or type [] in any note.`}
                </p>
              </div>
              <RadioGroup
                width={160}
                items={[
                  { value: 'list', label: 'List', testId: 'tasks-view-list' },
                  {
                    value: 'board',
                    label: 'Board',
                    testId: 'tasks-view-board',
                  },
                ]}
                value={view}
                onChange={onViewChange}
              />
            </header>
            {view === 'list' ? (
              <>
                <TaskComposer
                  today={today}
                  onAdd={onAdd}
                  testId="tasks-composer"
                />
                {tasks !== null && tasks.length === 0 ? (
                  <div className={styles.empty}>
                    No tasks yet. Add one above, or type <code>[]</code>{' '}
                    followed by a space in any note.
                  </div>
                ) : null}
                {reminders.length ? (
                  <section
                    className={styles.group}
                    data-testid="tasks-group-reminders"
                  >
                    <div className={styles.groupHeader}>
                      <span className={styles.groupLabel}>Reminders</span>
                      <span className={styles.groupCount}>
                        {reminders.length}
                      </span>
                    </div>
                    {reminders.map(reminder => (
                      <ReminderRow
                        key={reminder.id}
                        reminder={reminder}
                        onOpen={onOpenReminder}
                        onRemove={onRemoveReminder}
                      />
                    ))}
                  </section>
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
                            data-today={group.id === 'today'}
                          >
                            {group.label}
                          </span>
                        )}
                        <span className={styles.groupCount}>
                          {items.length}
                        </span>
                      </div>
                      {!isDone || showDone
                        ? (isDone ? items.slice(0, MAX_DONE) : items).map(
                            task => (
                              <TaskRow
                                key={taskKey(task)}
                                task={task}
                                group={group.id}
                                today={today}
                                onToggle={onToggle}
                                onOpen={onOpen}
                              />
                            )
                          )
                        : null}
                    </section>
                  );
                })}
              </>
            ) : (
              <div className={styles.board}>
                {COLUMNS.map(column => (
                  <BoardColumn
                    key={column.id}
                    column={column.id}
                    label={column.label}
                    tasks={columns.get(column.id) ?? []}
                    today={today}
                    onMove={onMove}
                    onOpen={onOpen}
                    onAdd={onAdd}
                    onDropTask={onDropTask}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <TasksPage />;
};
