import type { ListBlockModel } from '@blocksuite/affine/model';
import type { Store } from '@blocksuite/affine/store';
import dayjs from 'dayjs';
import { map, type Observable } from 'rxjs';

import { DocsService } from '../doc';
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
        linkedDates.push(lookup.journalDate(pageId));
        text += lookup.title(pageId);
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

/** Docs that contain at least one list block, according to the search index. */
export function watchTaskDocIds(workspace: Workspace): Observable<string[]> {
  return workspace.engine.indexer
    .aggregate$(
      'block',
      { type: 'match', field: 'flavour', match: 'affine:list' },
      'docId',
      { pagination: { limit: MAX_TASK_DOCS } }
    )
    .pipe(map(({ buckets }) => buckets.map(bucket => bucket.key)));
}

function getLiveStore(workspace: Workspace, docId: string) {
  return workspace.docCollection.getDoc(docId)?.getStore() ?? null;
}

export async function loadWorkspaceTasks(
  workspace: Workspace,
  docIds: string[]
): Promise<TaskItem[]> {
  const docsService = workspace.scope.get(DocsService);
  const lookup: TaskDocLookup = {
    journalDate: id => {
      const journal =
        docsService.list.doc$(id).value?.properties$.value.journal;
      return journal && /^\d{4}-\d{2}-\d{2}$/.test(journal)
        ? journal
        : undefined;
    },
    title: id => docsService.list.doc$(id).value?.title$.value || 'Untitled',
  };
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
