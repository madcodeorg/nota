import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { AiBackendConfig } from './config';

const mock = vi.hoisted(() => ({
  factory: vi.fn(),
  inference: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./device-memory', () => ({
  availableMemoryBytes: () => 8 * 1024 ** 3,
}));

let root: string;
let config: AiBackendConfig;
let search: typeof import('./workspace-search');
const scope = { workspaceId: 'alpha', userId: 'alice' };
const vector = [1, 0, 0, 0, 0, 0, 0, 0];
const doc = {
  docId: 'note',
  title: 'Launch',
  markdown: '# Launch\n\nLaunch checklist approved.',
};

beforeEach(async () => {
  vi.resetModules();
  mock.inference
    .mockReset()
    .mockImplementation(async (texts: string[]) => texts.map(() => vector));
  mock.dispose.mockReset().mockResolvedValue(undefined);
  mock.factory
    .mockReset()
    .mockResolvedValue(
      Object.assign(mock.inference, { dispose: mock.dispose })
    );
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-search-audit-'));
  config = {
    workspaceRoot: root,
    embeddingMode: 'semantic',
    embeddingAllowRemote: false,
    embeddingModel: 'test-model',
  } as AiBackendConfig;
  search = await import('./workspace-search');
  search.setEmbeddingTransformersLoaderForTesting(async () => ({
    env: {
      allowLocalModels: true,
      allowRemoteModels: false,
      localModelPath: root,
    },
    pipeline: mock.factory,
  }));
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    documents: [doc],
  });
});

afterEach(async () => {
  search.setEmbeddingTransformersLoaderForTesting(null);
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

test('caps cached user scopes at 32 entries by evicting the oldest build', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = Date.now();
  const fallback = { ...config, embeddingMode: 'fallback' as const };
  for (let index = 0; index < 33; index++) {
    vi.setSystemTime(start + index);
    await search.searchWorkspace(fallback, {
      ...scope,
      userId: `user-${index}`,
      query: 'Launch',
    });
  }
  vi.setSystemTime(start + 100);
  const retained = await search.searchWorkspace(fallback, {
    ...scope,
    userId: 'user-1',
    query: 'Launch',
  });
  expect(retained.index.builtAt).toBe(new Date(start + 1).toISOString());
  const evicted = await search.searchWorkspace(fallback, {
    ...scope,
    userId: 'user-0',
    query: 'Launch',
  });
  expect(evicted.index.builtAt).toBe(new Date(start + 100).toISOString());
});

test('lookup prunes expired entries belonging to other scopes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = Date.now();
  const fallback = { ...config, embeddingMode: 'fallback' as const };
  await search.searchWorkspace(fallback, { ...scope, query: 'Launch' });
  vi.setSystemTime(start + 60_000);
  await search.searchWorkspace(fallback, {
    ...scope,
    userId: 'bob',
    query: 'Launch',
  });
  // Moving back inside the TTL distinguishes eviction from ignoring an expired hit.
  vi.setSystemTime(start + 1);
  const pruned = await search.searchWorkspace(fallback, {
    ...scope,
    query: 'Launch',
  });
  expect(pruned.index.builtAt).toBe(new Date(start + 1).toISOString());
});

test('bounds retries under continuous writes and fails closed', async () => {
  mock.inference.mockImplementation(async (texts: string[]) => {
    await search.upsertWorkspaceContentDocuments(config, {
      workspaceId: 'alpha',
      documents: [doc],
    });
    return texts.map(() => vector);
  });
  await expect(
    search.searchWorkspace(config, { ...scope, query: 'Launch' })
  ).rejects.toThrow(/Please retry/);
  expect(mock.inference.mock.calls.length).toBeLessThanOrEqual(6);
});

test('requires explicit workspace scope but accepts the HTTP local-user default', async () => {
  await expect(
    search.searchWorkspace(config, { query: 'Launch', userId: 'local-user' })
  ).rejects.toThrow(/workspaceId/);
  await expect(
    search.searchWorkspace(config, { query: 'Launch', workspaceId: 'alpha' })
  ).rejects.toThrow(/userId/);
  const result = await search.searchWorkspace(config, {
    query: 'Launch',
    workspaceId: 'alpha',
    userId: 'local-user',
  });
  expect(result.results[0]?.docId).toBe('note');
});

test('rejects absent scope and embeds/counts only readable documents', async () => {
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    documents: [
      {
        ...doc,
        docId: 'secret',
        markdown: 'Restricted synthetic content.',
        visibility: 'private',
        allowedUserIds: ['bob'],
      },
    ],
  });
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'beta',
    documents: [{ ...doc, markdown: 'Other workspace synthetic content.' }],
  });
  await expect(
    search.searchWorkspace(config, { query: 'Launch' })
  ).rejects.toThrow(/workspaceId/);
  const result = await search.searchWorkspace(config, {
    ...scope,
    query: 'Launch',
  });
  expect(result.index.files).toBe(1);
  expect(result.results.map(item => item.docId)).toEqual(['note']);
  expect(JSON.stringify(mock.inference.mock.calls)).not.toMatch(
    /Restricted|Other workspace/
  );
});

test('falls back when document or query inference throws', async () => {
  mock.inference.mockRejectedValueOnce(new Error('inference failed'));
  const first = await search.searchWorkspace(config, {
    ...scope,
    query: 'Launch',
  });
  expect(first.searchType).toBe('local-hash-embedding');
  expect(first.results[0]?.docId).toBe('note');
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    documents: [doc],
  });
  mock.inference
    .mockResolvedValueOnce([vector])
    .mockRejectedValueOnce(new Error('query failed'));
  const second = await search.searchWorkspace(config, {
    ...scope,
    query: 'Launch',
  });
  expect(second.searchType).toBe('local-hash-embedding');
  expect(second.results[0]?.docId).toBe('note');
});

test('refreshes changed text and removes deleted documents', async () => {
  await search.searchWorkspace(config, { ...scope, query: 'Launch' });
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    documents: [
      { ...doc, markdown: '# Revised\n\nRevised content for launch.' },
    ],
  });
  const changed = await search.searchWorkspace(config, {
    ...scope,
    query: 'Revised',
  });
  expect(changed.results[0]?.snippet).toContain('Revised');
  expect(changed.index.embeddingCacheMisses).toBe(1);
  await search.deleteWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    docIds: ['note'],
  });
  expect(
    (await search.searchWorkspace(config, { ...scope, query: 'Launch' }))
      .results
  ).toEqual([]);
});

test('does not publish or return a stale build after deletion during inference', async () => {
  let finish!: (value: number[][]) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  mock.inference.mockImplementationOnce(() => {
    started();
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const pending = search.searchWorkspace(config, { ...scope, query: 'Launch' });
  await entered;
  await search.deleteWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    docIds: ['note'],
  });
  finish([vector]);
  expect((await pending).results).toEqual([]);
  expect(
    (await search.searchWorkspace(config, { ...scope, query: 'Launch' }))
      .results
  ).toEqual([]);
});

test('shares concurrent builds and does not evict active inference', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let finish!: (value: number[][]) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  mock.inference.mockImplementationOnce(() => {
    started();
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const pending = search.searchWorkspace(config, { ...scope, query: 'Launch' });
  await entered;
  const other = search.searchWorkspace(config, { ...scope, query: 'Launch' });
  await vi.advanceTimersByTimeAsync(240_000);
  expect(mock.dispose).not.toHaveBeenCalled();
  finish([vector]);
  await Promise.all([pending, other]);
  expect(mock.factory).toHaveBeenCalledTimes(1);
  expect(
    mock.inference.mock.calls.filter(([texts]) =>
      texts[0].includes('checklist')
    )
  ).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mock.dispose).toHaveBeenCalledTimes(1);
});

test('rejects corrupt cached vectors rather than coercing or shortening them', async () => {
  await search.searchWorkspace(config, { ...scope, query: 'Launch' });
  const cachePath = path.join(root, '.nota/search/test-model-embeddings.json');
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  cache.entries[0].vector = [1, null, 0, 0, 0, 0, 0, 0, 0];
  await writeFile(cachePath, JSON.stringify(cache));
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    documents: [doc],
  });
  const result = await search.searchWorkspace(config, {
    ...scope,
    query: 'Launch',
  });
  expect(result.index.embeddingCacheHits).toBe(0);
  expect(result.index.embeddingCacheMisses).toBe(1);
});

test('fallback mode never loads a model and suppresses unrelated results', async () => {
  const result = await search.searchWorkspace(
    { ...config, embeddingMode: 'fallback' },
    { ...scope, query: 'zzzzqqqqxxxx' }
  );
  expect(result.results).toEqual([]);
  expect(mock.factory).not.toHaveBeenCalled();
});

test('missing local models fall back without enabling downloads', async () => {
  mock.factory.mockRejectedValue(new Error('model unavailable'));
  const result = await search.searchWorkspace(config, {
    ...scope,
    query: 'Launch',
  });
  expect(result.searchType).toBe('local-hash-embedding');
  expect(result.results[0]?.docId).toBe('note');
  expect(mock.factory).toHaveBeenCalledWith(
    'feature-extraction',
    'test-model',
    expect.objectContaining({ local_files_only: true })
  );
});

test('cache publication failure does not break retrieval', async () => {
  await mkdir(path.join(root, '.nota/search/test-model-embeddings.json'));
  const result = await search.searchWorkspace(config, {
    ...scope,
    query: 'Launch',
  });
  expect(result.results[0]?.docId).toBe('note');
});

test('revocation while query inference is pending excludes the old readable chunk', async () => {
  await search.searchWorkspace(config, { ...scope, query: 'Launch' });
  let finish!: (value: number[][]) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  mock.inference.mockImplementationOnce(() => {
    started();
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const pending = search.searchWorkspace(config, { ...scope, query: 'Launch' });
  await entered;
  await search.upsertWorkspaceContentDocuments(config, {
    workspaceId: 'alpha',
    documents: [{ ...doc, visibility: 'private', allowedUserIds: ['bob'] }],
  });
  finish([vector]);
  expect((await pending).results).toEqual([]);
});
