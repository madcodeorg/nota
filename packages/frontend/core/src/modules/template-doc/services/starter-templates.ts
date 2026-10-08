import type {
  ColumnDataType,
  DatabaseBlockModel,
  ParagraphType,
  SerializedCells,
} from '@blocksuite/affine/model';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { type DeltaInsert, type Store, Text } from '@blocksuite/affine/store';
import { DebugLogger } from '@nota/debug';
import dayjs from 'dayjs';

import type { DocRecord } from '../../doc/entities/record';
import type { DocsService } from '../../doc/services/docs';

const logger = new DebugLogger('LocalStarterTemplates');

export const LOCAL_STARTER_TEMPLATES = [
  {
    id: 'projects-and-tasks',
    title: 'Projects and Tasks',
    description: 'Connected projects, tasks and a project brief.',
  },
  {
    id: 'knowledge-notes',
    title: 'Knowledge Notes',
    description: 'A notes index with a linked note to start writing.',
  },
  {
    id: 'daily-journal',
    title: 'Daily Journal',
    description: 'Priorities, notes and a daily reflection.',
  },
  {
    id: 'meeting-follow-up',
    title: 'Meeting Follow-up',
    description: 'Linked meeting notes, decisions and action items.',
  },
] as const;

export type LocalStarterTemplateId =
  (typeof LOCAL_STARTER_TEMPLATES)[number]['id'];

function paragraph(
  store: Store,
  noteId: string,
  text = '',
  type: ParagraphType = 'text'
) {
  return store.addBlock(
    'affine:paragraph',
    { type, text: new Text(text) },
    noteId
  );
}

function section(store: Store, noteId: string, title: string, prompt = '') {
  paragraph(store, noteId, title, 'h2');
  paragraph(store, noteId, prompt);
}

function linkedPage(store: Store, noteId: string, docId: string) {
  store.addBlock(
    'affine:paragraph',
    {
      text: new Text([
        {
          insert: ' ',
          attributes: { reference: { type: 'LinkedPage', pageId: docId } },
        },
      ] as DeltaInsert<AffineTextAttributes>[]),
    },
    noteId
  );
}

function column(
  store: Store,
  type: string,
  name: string,
  data: Record<string, unknown> = {}
): ColumnDataType {
  return { id: store.workspace.idGenerator(), type, name, data };
}

function statusColumn(store: Store) {
  return column(store, 'select', 'Status', {
    options: [
      { id: 'todo', value: 'Todo', color: 'var(--affine-tag-gray)' },
      {
        id: 'in-progress',
        value: 'In Progress',
        color: 'var(--affine-tag-blue)',
      },
      { id: 'done', value: 'Done', color: 'var(--affine-tag-green)' },
    ],
  });
}

function database(
  store: Store,
  noteId: string,
  title: string,
  columns: ColumnDataType[]
) {
  const tableView = {
    id: store.workspace.idGenerator(),
    name: 'Table',
    mode: 'table',
    columns: columns.map(column => ({ id: column.id, width: 200 })),
    header: { titleColumn: columns[0]?.id, iconColumn: 'type' },
    filter: { type: 'group', op: 'and', conditions: [] },
  };
  const id = store.addBlock(
    'affine:database',
    { title: new Text(title), columns, views: [tableView] },
    noteId
  );
  const block = store.getBlock(id);
  if (!block) throw new Error('The starter database could not be created.');
  return block.model as DatabaseBlockModel;
}

function row(
  store: Store,
  database: DatabaseBlockModel,
  title: string,
  values: Record<string, unknown> = {}
) {
  const id = paragraph(store, database.id, title);
  const cells: SerializedCells = {
    ...database.props.cells,
    [id]: Object.fromEntries(
      Object.entries(values).map(([columnId, value]) => [
        columnId,
        { columnId, value },
      ])
    ),
  };
  store.updateBlock(database, { cells });
  return id;
}

function projectsAndTasks(store: Store, noteId: string, briefId: string) {
  const projectTitle = column(store, 'title', 'Project');
  const projectStatus = statusColumn(store);
  const projects = database(store, noteId, 'Projects', [
    projectTitle,
    projectStatus,
  ]);
  const exampleProject = row(store, projects, 'Example project', {
    [projectStatus.id]: 'todo',
  });
  const taskStatus = statusColumn(store);
  const projectRelation = column(store, 'relation', 'Project', {
    targetDocId: store.id,
    targetDatabaseId: projects.id,
  });
  const due = column(store, 'date', 'Due');
  const tasks = database(store, noteId, 'Tasks', [
    column(store, 'title', 'Task'),
    taskStatus,
    projectRelation,
    due,
  ]);
  row(store, tasks, 'Write the project brief', {
    [taskStatus.id]: 'todo',
    [projectRelation.id]: [exampleProject],
    [due.id]: null,
  });
  section(store, noteId, 'Project brief');
  linkedPage(store, noteId, briefId);
  section(
    store,
    noteId,
    'Related notes',
    'Use @ to link notes, decisions and meeting follow-ups to your project.'
  );
}

function knowledgeNotes(store: Store, noteId: string, noteDocId: string) {
  const source = column(store, 'link', 'Source');
  const reviewed = column(store, 'checkbox', 'Reviewed');
  const notes = database(store, noteId, 'Notes', [
    column(store, 'title', 'Note'),
    source,
    reviewed,
  ]);
  row(store, notes, 'First knowledge note', {
    [source.id]: '',
    [reviewed.id]: false,
  });
  section(store, noteId, 'Start writing');
  linkedPage(store, noteId, noteDocId);
  section(
    store,
    noteId,
    'Related notes',
    'Link related pages with @. Their backlinks keep your notes connected.'
  );
}

function dailyJournal(store: Store, noteId: string) {
  paragraph(store, noteId, 'Priorities', 'h2');
  store.addBlock(
    'affine:list',
    {
      type: 'todo',
      text: new Text('Choose one useful next step'),
      checked: false,
    },
    noteId
  );
  section(store, noteId, 'Notes');
  section(
    store,
    noteId,
    'Reflection',
    'What went well? What would you change?'
  );
  section(
    store,
    noteId,
    'Related pages',
    'Use @ to link today’s notes and projects.'
  );
}

function meetingFollowUp(store: Store, noteId: string, meetingDocId: string) {
  section(store, noteId, 'Meeting notes');
  linkedPage(store, noteId, meetingDocId);
  section(store, noteId, 'Decisions');
  const status = statusColumn(store);
  const owner = column(store, 'rich-text', 'Owner');
  const due = column(store, 'date', 'Due');
  const actions = database(store, noteId, 'Action items', [
    column(store, 'title', 'Action'),
    status,
    owner,
    due,
  ]);
  row(store, actions, 'Add an agreed action', {
    [status.id]: 'todo',
    [due.id]: null,
  });
  section(store, noteId, 'Open questions');
  section(
    store,
    noteId,
    'Related project',
    'Use @ to link the project this meeting belongs to.'
  );
}

/** Explicitly creates editable local docs; importing this module seeds nothing. */
export function createLocalStarter(
  docsService: Pick<DocsService, 'createDoc'>,
  starterId: LocalStarterTemplateId,
  today = new Date()
) {
  const starter = LOCAL_STARTER_TEMPLATES.find(item => item.id === starterId);
  if (!starter) throw new Error('Unknown starter template');
  const day = dayjs(today).format('YYYY-MM-DD');
  if (starterId === 'daily-journal' && !dayjs(today).isValid()) {
    throw new Error('Invalid journal date');
  }

  let linkedDoc: DocRecord | undefined;
  if (starterId !== 'daily-journal') {
    const linkedTitles = {
      'projects-and-tasks': 'Example project brief',
      'knowledge-notes': 'First knowledge note',
      'meeting-follow-up': 'Meeting notes',
    };
    linkedDoc = docsService.createDoc({
      title: linkedTitles[starterId],
      primaryMode: 'page',
      docProps: {
        onStoreLoad: (store, { noteId }) => {
          if (starterId === 'projects-and-tasks') {
            section(store, noteId, 'Goal');
            section(store, noteId, 'Scope');
            section(store, noteId, 'Success criteria');
          } else if (starterId === 'knowledge-notes') {
            section(store, noteId, 'Summary');
            section(store, noteId, 'Sources');
            section(store, noteId, 'Related notes');
          } else {
            section(store, noteId, 'Agenda');
            section(store, noteId, 'Notes or transcript');
            section(store, noteId, 'Decisions');
          }
        },
      },
    });
  }

  let record: DocRecord;
  try {
    record = docsService.createDoc({
      title: starterId === 'daily-journal' ? day : starter.title,
      primaryMode: 'page',
      docProps: {
        paragraph: { text: new Text(starter.description) },
        onStoreLoad: (store, { noteId }) => {
          if (starterId === 'daily-journal') {
            dailyJournal(store, noteId);
            return;
          }
          if (!linkedDoc)
            throw new Error('The starter companion page is missing.');
          const linkedId = linkedDoc.id;
          switch (starterId) {
            case 'projects-and-tasks':
              projectsAndTasks(store, noteId, linkedId);
              break;
            case 'knowledge-notes':
              knowledgeNotes(store, noteId, linkedId);
              break;
            case 'meeting-follow-up':
              meetingFollowUp(store, noteId, linkedId);
              break;
          }
        },
      },
    });
  } catch (error) {
    // Keep the completed companion recoverable without duplicating it on retry.
    try {
      linkedDoc?.moveToTrash();
    } catch (cleanupError) {
      logger.error('Failed to move incomplete starter companion to Trash', {
        docId: linkedDoc?.id,
        error: cleanupError,
      });
    }
    throw error;
  }
  if (starterId === 'daily-journal') record.setProperty('journal', day);
  return record.id;
}
