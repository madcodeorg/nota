import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import type { AiBackendConfig } from './config.js';
import { createNotaToolContext } from './tools.js';
import {
  listWorkspaceDocuments,
  readWorkspaceDocument,
  searchWorkspace,
  upsertWorkspaceContentDocuments,
  workspaceSearchNeeded,
} from './workspace-search.js';

const temporaryRoots: string[] = [];

async function createWorkspaceFixture() {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nota-workspace-content-')
  );
  temporaryRoots.push(workspaceRoot);
  const config = { workspaceRoot } as AiBackendConfig;

  await upsertWorkspaceContentDocuments(config, {
    workspaceId: 'workspace-alpha',
    documents: [
      {
        docId: 'shared-doc',
        markdown: '# Alpha shared\n\nAlpha workspace content.',
        title: 'Shared document',
        visibility: 'workspace',
      },
      {
        allowedUserIds: ['alice'],
        docId: 'alice-private',
        markdown: '# Alice private',
        title: 'Alice private',
        visibility: 'private',
      },
      {
        allowedUserIds: ['bob'],
        docId: 'bob-private',
        markdown: '# Bob private',
        title: 'Bob private',
        visibility: 'private',
      },
      {
        allowedUserIds: ['alice'],
        docId: 'alice-restricted',
        markdown: '# Alice restricted',
        title: 'Alice restricted workspace document',
        visibility: 'workspace',
      },
      {
        docId: 'unassigned-private',
        markdown: '# Nobody can read this',
        title: 'Unassigned private',
        visibility: 'private',
      },
    ],
  });
  await upsertWorkspaceContentDocuments(config, {
    workspaceId: 'workspace-beta',
    documents: [
      {
        docId: 'shared-doc',
        markdown: '# Beta shared\n\nBeta workspace content.',
        title: 'Shared document',
        visibility: 'workspace',
      },
      {
        docId: 'beta-only',
        markdown: '# Beta only',
        title: 'Beta only',
        visibility: 'workspace',
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

describe('Nota workspace document access', () => {
  test('lists only documents visible to the current user and workspace', async () => {
    const config = await createWorkspaceFixture();

    const alice = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(alice.documents.map(document => document.docId).sort()).toEqual([
      'alice-private',
      'alice-restricted',
      'shared-doc',
    ]);
    expect(alice.total).toBe(3);
    expect(alice.documents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ docId: 'beta-only' }),
        expect.objectContaining({ docId: 'bob-private' }),
        expect.objectContaining({ docId: 'unassigned-private' }),
      ])
    );

    const bob = await listWorkspaceDocuments(config, {
      userId: 'bob',
      workspaceId: 'workspace-alpha',
    });
    expect(bob.documents.map(document => document.docId).sort()).toEqual([
      'bob-private',
      'shared-doc',
    ]);
  });

  test('requires verified read access for renderer-indexed documents', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-workspace-content-access-')
    );
    temporaryRoots.push(workspaceRoot);
    const config = { workspaceRoot } as AiBackendConfig;
    const document = {
      docId: 'unverified',
      markdown: '# Must not be indexed without an access decision',
      title: 'Unverified',
      visibility: 'workspace' as const,
    };

    await expect(
      upsertWorkspaceContentDocuments(config, {
        documents: [document],
        requireAccessVerification: true,
        workspaceId: 'workspace-alpha',
      })
    ).rejects.toThrow(/verified read access/i);

    const empty = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(empty.total).toBe(0);

    await upsertWorkspaceContentDocuments(config, {
      documents: [{ ...document, accessVerified: true }],
      requireAccessVerification: true,
      workspaceId: 'workspace-alpha',
    });
    const indexed = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(indexed.total).toBe(1);
  });

  test('replaces indexes over 120 documents only after the final ordered page', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-workspace-content-pages-')
    );
    temporaryRoots.push(workspaceRoot);
    const config = { workspaceRoot } as AiBackendConfig;
    const originalDocuments = Array.from({ length: 126 }, (_, index) => ({
      docId: `doc-${index}`,
      markdown: `# Original document ${index}`,
      title: `Document ${index}`,
      visibility: 'workspace' as const,
    }));
    await upsertWorkspaceContentDocuments(config, {
      documents: originalDocuments,
      workspaceId: 'workspace-alpha',
    });

    const firstPage = originalDocuments.slice(0, 70).map(document => ({
      ...document,
      markdown: `${document.markdown}\n\nUpdated`,
    }));
    await upsertWorkspaceContentDocuments(config, {
      documents: firstPage,
      replacement: {
        complete: false,
        page: 0,
        syncId: 'full-sync',
      },
      workspaceId: 'workspace-alpha',
    });

    const duringSync = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(duringSync.total).toBe(126);
    await expect(
      readWorkspaceDocument(config, {
        docId: 'doc-125',
        userId: 'alice',
        workspaceId: 'workspace-alpha',
      })
    ).resolves.toBeDefined();

    const finalPage = originalDocuments.slice(70, 125).map(document => ({
      ...document,
      markdown: `${document.markdown}\n\nUpdated`,
    }));
    const completed = await upsertWorkspaceContentDocuments(config, {
      documents: finalPage,
      replacement: {
        complete: true,
        page: 1,
        syncId: 'full-sync',
      },
      workspaceId: 'workspace-alpha',
    });
    expect(completed.indexed).toBe(55);
    expect(completed.removed).toBe(1);

    const afterSync = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(afterSync.total).toBe(125);
    await expect(
      readWorkspaceDocument(config, {
        docId: 'doc-125',
        userId: 'alice',
        workspaceId: 'workspace-alpha',
      })
    ).rejects.toThrow(/not found or is not accessible/i);
  });

  test('rejects out-of-order replacement pages without deleting existing content', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-workspace-content-order-')
    );
    temporaryRoots.push(workspaceRoot);
    const config = { workspaceRoot } as AiBackendConfig;
    await upsertWorkspaceContentDocuments(config, {
      documents: [
        {
          docId: 'keep-me',
          markdown: '# Existing content',
          title: 'Existing content',
        },
      ],
      workspaceId: 'workspace-alpha',
    });

    await expect(
      upsertWorkspaceContentDocuments(config, {
        documents: [],
        replacement: {
          complete: true,
          page: 1,
          syncId: 'out-of-order',
        },
        workspaceId: 'workspace-alpha',
      })
    ).rejects.toThrow(/arrive in order/i);

    const documents = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(documents.total).toBe(1);
    expect(documents.documents[0]?.docId).toBe('keep-me');
  });

  test('serializes concurrent index mutations without losing documents', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-workspace-content-concurrent-')
    );
    temporaryRoots.push(workspaceRoot);
    const config = { workspaceRoot } as AiBackendConfig;

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        upsertWorkspaceContentDocuments(config, {
          documents: [
            {
              docId: `concurrent-${index}`,
              markdown: `# Concurrent document ${index}`,
              title: `Concurrent document ${index}`,
            },
          ],
          workspaceId: 'workspace-alpha',
        })
      )
    );

    const documents = await listWorkspaceDocuments(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(documents.total).toBe(24);
  });

  test('reads the exact scoped document without crossing workspace ids', async () => {
    const config = await createWorkspaceFixture();

    const alpha = await readWorkspaceDocument(config, {
      docId: 'shared-doc',
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });
    expect(alpha.document.markdown).toContain('Alpha workspace content.');
    expect(alpha.document.markdown).not.toContain('Beta workspace content.');
    expect(alpha.document.sourceRef).toBe('nota://workspace-alpha/shared-doc');

    const beta = await readWorkspaceDocument(config, {
      docId: 'shared-doc',
      userId: 'alice',
      workspaceId: 'workspace-beta',
    });
    expect(beta.document.markdown).toContain('Beta workspace content.');
  });

  test('does not reveal whether a private or out-of-workspace document exists', async () => {
    const config = await createWorkspaceFixture();
    const errorFor = async (docId: string) => {
      try {
        await readWorkspaceDocument(config, {
          docId,
          userId: 'alice',
          workspaceId: 'workspace-alpha',
        });
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return '';
    };

    const missingError = await errorFor('missing-doc');
    expect(await errorFor('bob-private')).toBe(missingError);
    expect(await errorFor('beta-only')).toBe(missingError);
    expect(missingError).toMatch(/not found or is not accessible/i);
  });

  test('binds document tools to the trusted session scope', async () => {
    const fixtureConfig = await createWorkspaceFixture();
    const config = {
      ...fixtureConfig,
      mcpConfig: '',
      mcpEnabled: false,
      toolsEnabled: true,
      workspaceSearchToolEnabled: true,
    } as AiBackendConfig;
    const context = await createNotaToolContext(config, {
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });

    try {
      const readTool = context.tools?.read_nota_document as
        | {
            execute?: (
              input: Record<string, unknown>,
              options: { messages: []; toolCallId: string }
            ) => unknown;
          }
        | undefined;
      expect(readTool?.execute).toBeTypeOf('function');
      const result = (await readTool?.execute?.(
        {
          docId: 'shared-doc',
          workspaceId: 'workspace-beta',
        },
        { messages: [], toolCallId: 'scope-test' }
      )) as Awaited<ReturnType<typeof readWorkspaceDocument>>;

      expect(result.document.workspaceId).toBe('workspace-alpha');
      expect(result.document.markdown).toContain('Alpha workspace content.');
      expect(result.document.markdown).not.toContain('Beta workspace content.');
    } finally {
      await context.close();
    }
  });

  test('never indexes unrelated files from the backend app-data root', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-workspace-content-root-scope-')
    );
    temporaryRoots.push(workspaceRoot);
    const config = {
      embeddingAllowRemote: false,
      embeddingMode: 'fallback',
      embeddingModel: 'all-minilm-l6-v2-embedding',
      workspaceRoot,
    } as AiBackendConfig;
    await writeFile(
      path.join(workspaceRoot, 'unrelated-auth-state.json'),
      JSON.stringify({ secret: 'private-root-needle' })
    );
    await upsertWorkspaceContentDocuments(config, {
      documents: [
        {
          accessVerified: true,
          docId: 'safe-note',
          markdown: '# Safe note\n\nRelease checklist.',
          title: 'Safe note',
        },
      ],
      requireAccessVerification: true,
      workspaceId: 'workspace-alpha',
    });

    const result = await searchWorkspace(config, {
      query: 'private-root-needle',
      userId: 'alice',
      workspaceId: 'workspace-alpha',
    });

    expect(result.results).toEqual([]);
    expect(result.index?.files).toBe(1);
  });
});

describe('workspace retrieval preflight', () => {
  test.each([
    'What did we decide about the launch date?',
    'Who owns customer onboarding?',
    'pricing?',
    'Explain our refund policy',
  ])('searches for substantive workspace questions: %s', content => {
    expect(workspaceSearchNeeded(content)).toBe(true);
  });

  test.each(['', 'Hi!', 'Thanks', 'ok', 'How are you?', 'What can you do?'])(
    'skips greetings and tiny chat: %s',
    content => {
      expect(workspaceSearchNeeded(content)).toBe(false);
    }
  );
});
