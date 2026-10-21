import type { StreamObject } from '../ai-chat-messages';

export interface NotaToolViewItem {
  title: string;
  content?: string;
  docId?: string;
  href?: string;
}

export interface NotaToolView {
  name: string;
  failed?: boolean;
  items: NotaToolViewItem[];
}

type ToolObject = Extract<StreamObject, { type: 'tool-call' | 'tool-result' }>;

/** Returns a note title for docs that exist in this workspace. */
export type NotaDocTitle = (docId: string) => string | undefined;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const quoted = (value: string) => (value ? ` for "${value}"` : '');

function docItem(value: unknown, docTitle: NotaDocTitle): NotaToolViewItem {
  const item = record(value);
  const docId = text(item.docId);
  const title = (docId && docTitle(docId)) || text(item.title) || 'Untitled';
  return {
    title,
    content: text(item.snippet).slice(0, 280) || undefined,
    docId: docId && docTitle(docId) ? docId : undefined,
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function humanize(toolName: string) {
  const name = toolName.replace(/^mcp_/, '').replace(/[_-]+/g, ' ').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Tool';
}

/**
 * Plain-language card content for Nota's backend tools. Tool names, document
 * ids and raw JSON stay internal; the card shows note titles and snippets.
 */
export function notaToolView(
  object: ToolObject,
  docTitle: NotaDocTitle
): NotaToolView {
  const args = record(object.args);
  const done = object.type === 'tool-result';
  const result = done ? record(object.result) : {};
  const failed = done && result.status === 'error';

  switch (object.toolName) {
    case 'search_nota_workspace': {
      const query = text(args.query);
      const results = Array.isArray(result.results) ? result.results : [];
      if (!done)
        return { name: `Searching your notes${quoted(query)}`, items: [] };
      if (failed)
        return { name: "Couldn't search your notes", failed, items: [] };
      return {
        name: results.length
          ? `Found ${results.length} matching ${results.length === 1 ? 'note' : 'notes'}${quoted(query)}`
          : `No matching notes${quoted(query)}`,
        items: results.map(item => docItem(item, docTitle)),
      };
    }
    case 'read_nota_document': {
      const document = record(result.document);
      const docId = text(args.docId) || text(document.docId);
      const title =
        (docId && docTitle(docId)) || text(document.title) || 'a note';
      if (!done) return { name: `Reading ${title}`, items: [] };
      if (failed) return { name: "Couldn't read that note", failed, items: [] };
      return {
        name: `Read ${title}`,
        items: [docItem({ docId, title }, docTitle)],
      };
    }
    case 'list_nota_documents': {
      const documents = Array.isArray(result.documents) ? result.documents : [];
      if (!done) return { name: 'Looking through your notes', items: [] };
      if (failed)
        return { name: "Couldn't list your notes", failed, items: [] };
      return {
        name: `Looked through ${documents.length} ${documents.length === 1 ? 'note' : 'notes'}`,
        items: documents.map(item => docItem(item, docTitle)),
      };
    }
    case 'list_nota_tasks': {
      const tasks = Array.isArray(result.tasks) ? result.tasks : [];
      if (!done) return { name: 'Checking your tasks', items: [] };
      if (failed)
        return { name: "Couldn't check your tasks", failed, items: [] };
      return {
        name: tasks.length
          ? `Found ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`
          : 'No matching tasks',
        items: tasks.slice(0, 20).map(task => {
          const item = record(task);
          return {
            ...docItem({ docId: item.docId, title: item.docTitle }, docTitle),
            content: `${item.checked ? '[x]' : '[ ]'} ${text(item.text)}`,
          };
        }),
      };
    }
    case 'get_nota_links': {
      const document = record(result.document);
      const docId = text(args.docId) || text(document.docId);
      const title =
        (docId && docTitle(docId)) || text(document.title) || 'a note';
      if (!done) return { name: `Checking links for ${title}`, items: [] };
      if (failed)
        return { name: "Couldn't check that note's links", failed, items: [] };
      const linked = [
        ...(Array.isArray(result.outgoing) ? result.outgoing : []),
        ...(Array.isArray(result.backlinks) ? result.backlinks : []),
      ];
      const items = new Map<string, NotaToolViewItem>();
      for (const item of linked) {
        const docItemId = text(record(item).docId);
        if (docItemId && !items.has(docItemId)) {
          items.set(docItemId, docItem(item, docTitle));
        }
      }
      return {
        name: items.size
          ? `${title} connects to ${items.size} ${items.size === 1 ? 'note' : 'notes'}`
          : `${title} has no links`,
        items: [...items.values()],
      };
    }
    case 'web_crawl': {
      const url = text(args.url) || text(result.url);
      const host = hostOf(url);
      if (!done) return { name: `Reading ${host}`, items: [] };
      if (failed) return { name: `Couldn't read ${host}`, failed, items: [] };
      return {
        name: `Read ${host}`,
        items: url
          ? [
              {
                title: url,
                href: url,
                content: text(result.text).slice(0, 280) || undefined,
              },
            ]
          : [],
      };
    }
    case 'propose_nota_action':
      return {
        name: failed
          ? "Couldn't prepare the edit"
          : 'Preparing an edit for your approval',
        failed,
        items: [],
      };
    case 'nota_shell':
      return {
        name: failed
          ? "Couldn't inspect local files"
          : done
            ? 'Inspected local files'
            : 'Inspecting local files',
        failed,
        items: [],
      };
    case 'list_mcp_tools':
      return {
        name: done ? 'Checked connected tools' : 'Checking connected tools',
        failed,
        items: [],
      };
    default: {
      const label = humanize(object.toolName);
      return {
        name: failed
          ? `${label} failed`
          : done
            ? `Used ${label}`
            : `Using ${label}`,
        failed,
        items: [],
      };
    }
  }
}
