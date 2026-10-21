import type { AiBackendConfig } from './config';
import {
  listReadableWorkspaceContent,
  type WorkspaceDocument,
  type WorkspaceDocumentAccessInput,
} from './workspace-search';

export type WorkspaceTaskStatus = 'all' | 'done' | 'open';
export type WorkspaceTaskGroup =
  | 'done'
  | 'overdue'
  | 'someday'
  | 'today'
  | 'upcoming';

export interface WorkspaceTask {
  checked: boolean;
  docId: string;
  docTitle: string;
  /** YYYY-MM-DD */
  due: string | null;
  group: WorkspaceTaskGroup;
  text: string;
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const DEFAULT_TASK_LIMIT = 50;
const MAX_TASK_LIMIT = 200;

function isValidIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function localIsoDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Nota exports note links as `[title](<origin>/workspace/<workspaceId>/<docId>)`. */
export function linkedDocId(url: string, workspaceId: string) {
  const match = /\/workspace\/([^/?#]+)\/([^/?#]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) === workspaceId
      ? decodeURIComponent(match[2])
      : null;
  } catch {
    return null;
  }
}

function withoutCodeBlocks(markdown: string) {
  let fenced = false;
  return markdown.split(/\r?\n/).filter(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

function taskGroup(
  task: Pick<WorkspaceTask, 'checked' | 'due'>,
  today: string
): WorkspaceTaskGroup {
  if (task.checked) return 'done';
  if (!task.due) return 'someday';
  if (task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  return 'upcoming';
}

export function parseDocumentTasks(
  document: Pick<WorkspaceDocument, 'docId' | 'markdown' | 'title'>,
  options: {
    title: (docId: string) => string | undefined;
    today: string;
    workspaceId: string;
  }
): WorkspaceTask[] {
  const tasks: WorkspaceTask[] = [];
  for (const line of withoutCodeBlocks(document.markdown)) {
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    const linkedDates: string[] = [];
    const text = match[2]
      .replace(MARKDOWN_LINK, (_whole, label: string, url: string) => {
        const docId = linkedDocId(url, options.workspaceId);
        const title = (docId && options.title(docId)) || label;
        if (docId && /^\d{4}-\d{2}-\d{2}$/.test(title)) {
          linkedDates.push(title);
        }
        return title;
      })
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const textDate = ISO_DATE.exec(text)?.[1];
    const due =
      linkedDates.find(isValidIsoDate) ??
      (textDate && isValidIsoDate(textDate) ? textDate : null);
    const checked = match[1] !== ' ';
    tasks.push({
      checked,
      docId: document.docId,
      docTitle: document.title,
      due,
      group: taskGroup({ checked, due }, options.today),
      text,
    });
  }
  return tasks;
}

const GROUP_ORDER: WorkspaceTaskGroup[] = [
  'overdue',
  'today',
  'upcoming',
  'someday',
  'done',
];

export async function listWorkspaceTasks(
  config: AiBackendConfig,
  input: WorkspaceDocumentAccessInput & {
    docId?: string;
    limit?: number;
    status?: WorkspaceTaskStatus;
    today?: string;
  }
) {
  const documents = await listReadableWorkspaceContent(config, input);
  const titles = new Map(documents.map(doc => [doc.docId, doc.title]));
  const today = input.today ?? localIsoDate();
  const status = input.status ?? 'open';
  const limit = Math.min(
    Math.max(Math.floor(input.limit ?? DEFAULT_TASK_LIMIT), 1),
    MAX_TASK_LIMIT
  );
  const tasks = documents
    .filter(doc => !input.docId || doc.docId === input.docId)
    .flatMap(doc =>
      parseDocumentTasks(doc, {
        title: docId => titles.get(docId),
        today,
        workspaceId: input.workspaceId,
      })
    )
    .filter(task =>
      status === 'all' ? true : status === 'done' ? task.checked : !task.checked
    )
    .sort(
      (left, right) =>
        GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) ||
        (left.due ?? '').localeCompare(right.due ?? '') ||
        left.docTitle.localeCompare(right.docTitle)
    );

  const counts = Object.fromEntries(
    GROUP_ORDER.map(group => [
      group,
      tasks.filter(task => task.group === group).length,
    ])
  ) as Record<WorkspaceTaskGroup, number>;
  return {
    counts,
    status,
    tasks: tasks.slice(0, limit),
    today,
    total: tasks.length,
    workspaceId: input.workspaceId,
  };
}

function outgoingDocIds(markdown: string, workspaceId: string) {
  const ids = new Set<string>();
  for (const line of withoutCodeBlocks(markdown)) {
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const docId = linkedDocId(match[2], workspaceId);
      if (docId) ids.add(docId);
    }
  }
  return ids;
}

export async function getWorkspaceDocLinks(
  config: AiBackendConfig,
  input: WorkspaceDocumentAccessInput & { docId: string }
) {
  const docId = input.docId.trim();
  const documents = await listReadableWorkspaceContent(config, input);
  const document = documents.find(doc => doc.docId === docId);
  if (!document) {
    throw new Error('Nota document was not found or is not accessible.');
  }
  const byId = new Map(documents.map(doc => [doc.docId, doc]));
  const summary = (doc: WorkspaceDocument) => ({
    docId: doc.docId,
    title: doc.title,
  });
  // Unreadable link targets are omitted so their titles never leak.
  const outgoing = [...outgoingDocIds(document.markdown, input.workspaceId)]
    .filter(id => id !== docId)
    .flatMap(id => {
      const target = byId.get(id);
      return target ? [summary(target)] : [];
    });
  const backlinks = documents
    .filter(
      doc =>
        doc.docId !== docId &&
        outgoingDocIds(doc.markdown, input.workspaceId).has(docId)
    )
    .map(summary);

  return {
    backlinks,
    document: summary(document),
    outgoing,
    workspaceId: input.workspaceId,
  };
}
