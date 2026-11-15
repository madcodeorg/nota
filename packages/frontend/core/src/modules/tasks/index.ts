import type { ListBlockModel } from '@blocksuite/affine/model';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { type DeltaInsert, type Store, Text } from '@blocksuite/affine/store';
import { LiveData } from '@nota/infra';
import dayjs from 'dayjs';
import {
  combineLatest,
  distinctUntilChanged,
  map,
  type Observable,
} from 'rxjs';

import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { JournalService } from '../journal';
import type { Workspace } from '../workspace';

export interface TaskItem {
  docId: string;
  blockId: string;
  text: string;
  checked: boolean;
  /** YYYY-MM-DD */
  due: string | null;
}

export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'someday' | 'done';

export type TaskBoardColumn = 'todo' | 'doing' | 'done';

export interface TaskDocLookup {
  /** Journal date (YYYY-MM-DD) of a linked doc, if it is a journal. */
  journalDate(docId: string): string | undefined;
  title(docId: string): string;
}

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const DOC_LOAD_CONCURRENCY = 8;
const MAX_TASK_DOCS = 500;

/**
 * A linked journal page (typed with `@` + a date) wins over a plain
 * `YYYY-MM-DD` written in the text.
 */
export function findDueDate(
  text: string,
  linkedDates: (string | undefined)[]
): string | null {
  const linked = linkedDates.find(Boolean);
  if (linked) return linked;
  const match = ISO_DATE.exec(text)?.[1];
  return match && dayjs(match).format('YYYY-MM-DD') === match ? match : null;
}

export function taskGroup(
  task: Pick<TaskItem, 'checked' | 'due'>,
  today = dayjs().format('YYYY-MM-DD')
): TaskGroup {
  if (task.checked) return 'done';
  if (!task.due) return 'someday';
  if (task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  return 'upcoming';
}

export function taskKey(task: Pick<TaskItem, 'docId' | 'blockId'>) {
  return `${task.docId}:${task.blockId}`;
}

export function taskBoardColumn(
  task: Pick<TaskItem, 'checked'>,
  status: string | undefined
): TaskBoardColumn {
  if (task.checked) return 'done';
  return status === 'doing' ? 'doing' : 'todo';
}

export function readDocTasks(
  store: Store,
  docId: string,
  lookup: TaskDocLookup
): TaskItem[] {
  const tasks: TaskItem[] = [];
  for (const block of store.getBlocksByFlavour('affine:list')) {
    const model = block.model as ListBlockModel;
    if (model.props.type !== 'todo') continue;
    let text = '';
    const linkedDates: (string | undefined)[] = [];
    for (const op of model.props.text.toDelta()) {
      const pageId = op.attributes?.reference?.pageId;
      if (pageId) {
        const journalDate = lookup.journalDate(pageId);
        linkedDates.push(journalDate);
        // The due date is shown on its own, so a linked journal is not text.
        if (!journalDate) text += lookup.title(pageId);
      } else if (typeof op.insert === 'string') {
        text += op.insert;
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    tasks.push({
      docId,
      blockId: model.id,
      text,
      checked: !!model.props.checked,
      due: findDueDate(text, linkedDates),
    });
  }
  return tasks;
}

function watchTasksInboxIds(workspace: Workspace): Observable<string[]> {
  const docsService = workspace.scope.get(DocsService);
  return LiveData.computed(get =>
    get(docsService.list.docs$)
      .filter(
        doc =>
          !get(doc.trash$) && get(doc.properties$.selector(p => p.tasksInbox))
      )
      .map(doc => doc.id)
  ).pipe(distinctUntilChanged((a, b) => a.join() === b.join()));
}

/**
 * Docs that contain at least one list block, according to the search index,
 * plus the Tasks note so tasks added there show up before it is indexed.
 */
export function watchTaskDocIds(workspace: Workspace): Observable<string[]> {
  return combineLatest([
    workspace.engine.indexer
      .aggregate$(
        'block',
        { type: 'match', field: 'flavour', match: 'affine:list' },
        'docId',
        { pagination: { limit: MAX_TASK_DOCS } }
      )
      .pipe(map(({ buckets }) => buckets.map(bucket => bucket.key))),
    watchTasksInboxIds(workspace),
  ]).pipe(map(([indexed, inbox]) => [...new Set([...inbox, ...indexed])]));
}

function getLiveStore(workspace: Workspace, docId: string) {
  return workspace.docCollection.getDoc(docId)?.getStore() ?? null;
}

function createTaskLookup(workspace: Workspace): TaskDocLookup {
  const docsService = workspace.scope.get(DocsService);
  return {
    journalDate: id => {
      const journal =
        docsService.list.doc$(id).value?.properties$.value.journal;
      return journal && /^\d{4}-\d{2}-\d{2}$/.test(journal)
        ? journal
        : undefined;
    },
    title: id => docsService.list.doc$(id).value?.title$.value || 'Untitled',
  };
}

export async function loadWorkspaceTasks(
  workspace: Workspace,
  docIds: string[]
): Promise<TaskItem[]> {
  const docsService = workspace.scope.get(DocsService);
  const lookup = createTaskLookup(workspace);
  const ids = docIds.filter(id => {
    const record = docsService.list.doc$(id).value;
    return record && !record.trash$.value;
  });

  const results: TaskItem[][] = [];
  for (let i = 0; i < ids.length; i += DOC_LOAD_CONCURRENCY) {
    const batch = ids.slice(i, i + DOC_LOAD_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map(async docId => {
          const doc = workspace.docCollection.getDoc(docId);
          if (!doc) return [];
          doc.load();
          await workspace.engine.doc.waitForDocLoaded(docId);
          return readDocTasks(doc.getStore(), docId, lookup);
        })
      ))
    );
  }
  return results.flat();
}

export function setTaskChecked(
  workspace: Workspace,
  task: Pick<TaskItem, 'docId' | 'blockId'>,
  checked: boolean
) {
  const store = getLiveStore(workspace, task.docId);
  const model = store?.getModelById(task.blockId);
  if (!store || !model || store.readonly) return false;
  store.updateBlock(model, { checked });
  return true;
}

/** The note that holds tasks added from the Tasks page. Created on first use. */
function ensureTasksInbox(workspace: Workspace) {
  const docsService = workspace.scope.get(DocsService);
  const existing = docsService.list.docs$.value.find(
    doc => !doc.trash$.value && doc.properties$.value.tasksInbox
  );
  if (existing) return existing.id;
  const record = docsService.createDoc({ title: 'Tasks' });
  record.setProperty('tasksInbox', true);
  return record.id;
}

/** Adds a to-do to the Tasks note. A due date links that day's journal. */
export async function addTask(
  workspace: Workspace,
  input: { text: string; due?: string | null; checked?: boolean }
): Promise<TaskItem> {
  const text = input.text.trim();
  if (!text) throw new Error('A task needs some text.');
  const docId = ensureTasksInbox(workspace);
  const doc = workspace.docCollection.getDoc(docId);
  if (!doc) throw new Error(`Tasks note is unavailable: ${docId}`);
  doc.load();
  await workspace.engine.doc.waitForDocLoaded(docId);

  const store = doc.getStore();
  if (store.readonly) throw new Error('The Tasks note is locked.');
  const page = store.getBlocksByFlavour('affine:page')[0];
  if (!page) throw new Error(`Tasks note has no page block: ${docId}`);
  const noteId =
    store.getBlocksByFlavour('affine:note')[0]?.id ??
    store.addBlock('affine:note', {}, page.id);
  const note = store.getModelById(noteId);
  if (!note) throw new Error(`Tasks note has no note block: ${docId}`);
  // A fresh note starts with one empty paragraph; replace it.
  const only = note.children.length === 1 ? note.children[0] : null;
  if (only?.flavour === 'affine:paragraph' && !only.text?.toString().trim()) {
    store.deleteBlock(only);
  }

  const delta: DeltaInsert<AffineTextAttributes>[] = [{ insert: text }];
  if (input.due) {
    const journalId = workspace.scope
      .get(JournalService)
      .ensureJournalByDate(input.due).id;
    delta.push(
      { insert: ' ' },
      {
        insert: ' ',
        attributes: { reference: { type: 'LinkedPage', pageId: journalId } },
      }
    );
  }
  const blockId = store.addBlock(
    'affine:list',
    {
      type: 'todo',
      checked: !!input.checked,
      text: new Text(delta),
    },
    note.id
  );
  const task = readDocTasks(store, docId, createTaskLookup(workspace)).find(
    item => item.blockId === blockId
  );
  if (!task) throw new Error('Failed to add the task.');
  return task;
}

export function watchTaskBoardStatus(
  workspace: Workspace
): Observable<Map<string, string>> {
  return workspace.scope
    .get(WorkspaceDBService)
    .db.taskBoardStatus.find$()
    .pipe(map(rows => new Map(rows.map(row => [row.id, row.status]))));
}

/** Moves a task between board columns. Done checks it in its source note. */
export function moveTaskOnBoard(
  workspace: Workspace,
  task: Pick<TaskItem, 'docId' | 'blockId' | 'checked'>,
  column: TaskBoardColumn
) {
  const checked = column === 'done';
  if (task.checked !== checked && !setTaskChecked(workspace, task, checked)) {
    return false;
  }
  const table = workspace.scope.get(WorkspaceDBService).db.taskBoardStatus;
  if (column === 'doing') {
    table.create({ id: taskKey(task), status: 'doing' });
  } else {
    table.delete(taskKey(task));
  }
  return true;
}
