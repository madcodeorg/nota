import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import type { AiBackendConfig } from './config.js';
import { createNotaToolContext } from './tools.js';
import {
  getWorkspaceDocLinks,
  linkedDocId,
  listWorkspaceTasks,
} from './workspace-graph.js';
import { upsertWorkspaceContentDocuments } from './workspace-search.js';

const temporaryRoots: string[] = [];
const scope = { userId: 'alice', workspaceId: 'ws-1' };
const link = (docId: string, title = '') =>
  `[${title}](http://localhost:8080/workspace/ws-1/${docId})`;

async function fixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-graph-'));
  temporaryRoots.push(workspaceRoot);
  const config = { workspaceRoot } as AiBackendConfig;
  await upsertWorkspaceContentDocuments(config, {
    workspaceId: 'ws-1',
    documents: [
      {
        docId: 'plan',
        title: 'Launch plan',
        markdown: [
          '# Launch plan',
          `- [ ] Ship beta ${link('journal-1')}`,
          '- [x] Write notes',
          '- [ ] Email team 2026-01-02',
          '  - [ ] Book room',
          '```',
          '- [ ] not a task',
          '```',
          `See ${link('ideas', 'Ideas')} and ${link('secret')}.`,
        ].join('\n'),
      },
      { docId: 'journal-1', title: '2026-01-05', markdown: '# 2026-01-05' },
      {
        docId: 'ideas',
        title: 'Ideas',
        markdown: `Back to ${link('plan')}\n- [ ] Sketch logo`,
      },
      {
        allowedUserIds: ['bob'],
        docId: 'secret',
        title: 'Secret',
        markdown: `${link('plan')}\n- [ ] Hidden task`,
        visibility: 'private',
      },
    ],
  });
  return config;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { force: true, recursive: true }))
  );
});

describe('workspace tasks', () => {
  test('lists open tasks with due dates and groups, skipping code blocks', async () => {
    const config = await fixture();
    const result = await listWorkspaceTasks(config, {
      ...scope,
      today: '2026-01-03',
    });

    expect(result.tasks.map(task => [task.text, task.due, task.group])).toEqual(
      [
        ['Email team 2026-01-02', '2026-01-02', 'overdue'],
        ['Ship beta 2026-01-05', '2026-01-05', 'upcoming'],
        ['Sketch logo', null, 'someday'],
        ['Book room', null, 'someday'],
      ]
    );
    expect(result.tasks.some(task => task.text === 'Hidden task')).toBe(false);
    expect(result.total).toBe(4);
  });

  test('filters by status and document', async () => {
    const config = await fixture();
    const done = await listWorkspaceTasks(config, { ...scope, status: 'done' });
    expect(done.tasks.map(task => task.text)).toEqual(['Write notes']);

    const ideas = await listWorkspaceTasks(config, {
      ...scope,
      docId: 'ideas',
      status: 'all',
    });
    expect(ideas.tasks.map(task => task.docTitle)).toEqual(['Ideas']);
  });
});

describe('workspace links', () => {
  test('returns readable outgoing links and backlinks only', async () => {
    const config = await fixture();
    const result = await getWorkspaceDocLinks(config, {
      ...scope,
      docId: 'plan',
    });

    expect(result.outgoing).toEqual([
      { docId: 'journal-1', title: '2026-01-05' },
      { docId: 'ideas', title: 'Ideas' },
    ]);
    expect(result.backlinks).toEqual([{ docId: 'ideas', title: 'Ideas' }]);
  });

  test('rejects unreadable documents', async () => {
    const config = await fixture();
    await expect(
      getWorkspaceDocLinks(config, { ...scope, docId: 'secret' })
    ).rejects.toThrow(/not found or is not accessible/);
  });

  test('ignores links into another workspace', () => {
    expect(linkedDocId('/workspace/ws-2/doc', 'ws-1')).toBeNull();
    expect(linkedDocId('./workspace/ws-1/doc?mode=page', 'ws-1')).toBe('doc');
  });

  test('exposes both tools when workspace search is enabled', async () => {
    const config = {
      ...(await fixture()),
      mcpConfig: '',
      mcpEnabled: false,
      toolsEnabled: true,
      workspaceSearchToolEnabled: true,
    } as AiBackendConfig;
    const context = await createNotaToolContext(config, scope);
    try {
      expect(context.tools).toHaveProperty('list_nota_tasks');
      expect(context.tools).toHaveProperty('get_nota_links');
    } finally {
      await context.close();
    }
  });
});
