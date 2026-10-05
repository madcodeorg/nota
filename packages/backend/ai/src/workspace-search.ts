import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { AiBackendConfig } from './config';
import { availableMemoryBytes } from './device-memory';

const MAX_SNIPPET_CHARS = 520;
const MAX_VECTOR_FEATURES = 384;
const NEURAL_EMBEDDING_FAILURE_TTL_MS = 60_000;
const NEURAL_EMBEDDING_IDLE_TTL_MS = 120_000;
const NEURAL_EMBEDDING_MIN_AUTO_FREE_RAM_GB = 4;
const NEURAL_EMBEDDING_STANDARD_BATCH_SIZE = 8;
const NEURAL_EMBEDDING_LOW_RAM_BATCH_SIZE = 2;
const MAX_EMBEDDING_CACHE_ENTRIES = 6000;
const MAX_INDEX_CACHE_ENTRIES = 32;
const INDEX_CACHE_TTL_MS = 60_000;
const CHUNK_LINE_COUNT = 36;
const CHUNK_LINE_OVERLAP = 6;
const DEFAULT_EMBEDDING_MODEL = 'all-minilm-l6-v2-embedding';
const LEGACY_EMBEDDING_MODELS: Record<string, string> = {
  'Xenova/all-MiniLM-L6-v2': DEFAULT_EMBEDDING_MODEL,
};

export interface WorkspaceSearchInput {
  glob?: string;
  limit?: number;
  query: string;
  userId?: string | null;
  workspaceId?: string | null;
}

export interface WorkspaceDocumentAccessInput {
  userId: string;
  workspaceId: string;
}

export interface WorkspaceDocumentListInput extends WorkspaceDocumentAccessInput {
  limit?: number;
  query?: string;
}

export interface WorkspaceDocumentReadInput extends WorkspaceDocumentAccessInput {
  docId: string;
}

export interface WorkspaceDocumentSummary {
  docId: string;
  source: WorkspaceSearchResult['source'];
  sourceRef: string;
  title: string;
  updatedAt?: string;
  workspaceId: string;
}

export interface WorkspaceDocument extends WorkspaceDocumentSummary {
  markdown: string;
}

export interface WorkspaceContentDocumentInput {
  accessVerified?: boolean;
  allowedUserIds?: string[];
  docId: string;
  markdown: string;
  source?: WorkspaceSearchResult['source'];
  title: string;
  updatedAt?: string;
  visibility?: WorkspaceContentVisibility;
}

type SearchType =
  | 'lexical-fallback'
  | 'local-hash-embedding'
  | 'local-neural-embedding';

type WorkspaceContentVisibility = 'private' | 'workspace';

type WorkspaceSearchCitationKind =
  | 'attachment'
  | 'document'
  | 'line-range'
  | 'meeting-transcript'
  | 'table-row'
  | 'web';

export interface WorkspaceSearchCitation {
  blockId?: string;
  docId: string;
  endLine?: number;
  kind: WorkspaceSearchCitationKind;
  label: string;
  ref: string;
  section?: string;
  source: WorkspaceSearchResult['source'];
  startLine?: number;
  title: string;
  updatedAt?: string;
  workspaceId: string;
}

export interface WorkspaceSearchResult {
  blockId?: string;
  citation?: WorkspaceSearchCitation;
  docId: string;
  endLine?: number;
  id: string;
  score: number;
  section?: string;
  snippet: string;
  source: 'doc' | 'transcript' | 'attachment' | 'web';
  sourceRef?: string;
  startLine?: number;
  title: string;
  updatedAt?: string;
  workspaceId: string;
}

interface WorkspaceSearchChunk {
  blockId?: string;
  content: string;
  denseVector?: number[];
  denseVectorNorm?: number;
  docId: string;
  embeddingModel?: string;
  endLine: number;
  id: string;
  allowedUserIds?: string[];
  section?: string;
  source: WorkspaceSearchResult['source'];
  startLine: number;
  title: string;
  updatedAt?: string;
  vector: Map<number, number>;
  vectorNorm: number;
  visibility: WorkspaceContentVisibility;
  workspaceId?: string;
}

interface WorkspaceSearchIndex {
  builtAt: number;
  chunks: WorkspaceSearchChunk[];
  embeddingCacheHits?: number;
  embeddingCacheMisses?: number;
  embeddingDimensions?: number;
  embeddingModel?: string;
  files: number;
  root: string;
}

const indexCache = new Map<string, WorkspaceSearchIndex>();
let indexRevision = 0;
const indexBuilds = new Map<string, Promise<WorkspaceSearchIndex>>();
const embeddingPipelineUsers = new Map<string, number>();
const embeddingPipelines = new Map<
  string,
  Promise<FeatureExtractionPipeline>
>();
const embeddingFailures = new Map<string, number>();
const embeddingPipelineUnloadTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

type FeatureExtractionPipeline = ((
  input: string | string[],
  options?: Record<string, unknown>
) => Promise<unknown>) & { dispose?: () => Promise<unknown> };

interface EmbeddingTransformersRuntime {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    localModelPath: string;
  };
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>
  ) => Promise<FeatureExtractionPipeline>;
}

function dynamicImport<T = unknown>(specifier: string): Promise<T> {
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<T>;
  return importer(specifier);
}

const defaultEmbeddingLoader = () =>
  dynamicImport<EmbeddingTransformersRuntime>('@huggingface/transformers');
let embeddingLoader = defaultEmbeddingLoader;

export function setEmbeddingTransformersLoaderForTesting(
  loader: (() => Promise<EmbeddingTransformersRuntime>) | null
) {
  embeddingLoader = loader ?? defaultEmbeddingLoader;
}

interface EmbeddingCacheEntry {
  contentHash: string;
  docId: string;
  id: string;
  updatedAt?: string;
  vector: number[];
}

interface EmbeddingCacheFile {
  entries?: EmbeddingCacheEntry[];
  modelId?: string;
  updatedAt?: string;
  version?: number;
}

interface StoredWorkspaceContentDocument {
  allowedUserIds?: string[];
  docId: string;
  markdown: string;
  source: WorkspaceSearchResult['source'];
  title: string;
  updatedAt?: string;
  visibility: WorkspaceContentVisibility;
  workspaceId: string;
}

interface WorkspaceContentFile {
  documents?: StoredWorkspaceContentDocument[];
  updatedAt?: string;
  version?: number;
}

interface WorkspaceContentReplacementInput {
  complete: boolean;
  page: number;
  syncId: string;
}

interface WorkspaceContentReplacementSession {
  nextPage: number;
  seenDocIds: Set<string>;
  syncId: string;
  updatedAt: number;
}

const WORKSPACE_CONTENT_REPLACEMENT_TTL_MS = 10 * 60_000;
const workspaceContentMutationQueues = new Map<string, Promise<void>>();
const workspaceContentReplacementSessions = new Map<
  string,
  WorkspaceContentReplacementSession
>();

function clampLimit(limit: unknown) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) {
    return 8;
  }
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ');
}

export function workspaceSearchNeeded(content: string) {
  const normalized = normalizeQuery(content).toLowerCase();
  if (!normalized) return false;

  const conversationalText = normalized.replace(/[.!?,;:]+$/g, '').trim();
  if (
    /^(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening)|how are you|how's it going|who are you|what can you do|help|thank you|thanks|thx|ok|okay|yes|no|yep|nope|cool|great|nice|got it|sounds good)(?: there)?$/.test(
      conversationalText
    )
  ) {
    return false;
  }

  return true;
}

function queryTerms(query: string) {
  return normalizeQuery(query)
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/i)
    .filter(term => term.length > 1)
    .slice(0, 12);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/i)
    .filter(term => term.length > 1 && term.length < 80);
}

function hashFeature(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % MAX_VECTOR_FEATURES;
}

function vectorize(value: string) {
  const tokens = tokenize(value);
  const vector = new Map<number, number>();

  for (const token of tokens) {
    const key = hashFeature(token);
    vector.set(key, (vector.get(key) ?? 0) + 1);

    for (let size = 3; size <= 4; size++) {
      if (token.length <= size) {
        continue;
      }
      for (let index = 0; index <= token.length - size; index++) {
        const gram = token.slice(index, index + size);
        const gramKey = hashFeature(`gram:${gram}`);
        vector.set(gramKey, (vector.get(gramKey) ?? 0) + 0.18);
      }
    }
  }

  let norm = 0;
  for (const value of vector.values()) {
    norm += value * value;
  }

  return {
    norm: Math.sqrt(norm),
    vector,
  };
}

function cosineSimilarity(
  left: Map<number, number>,
  leftNorm: number,
  right: Map<number, number>,
  rightNorm: number
) {
  if (!leftNorm || !rightNorm) {
    return 0;
  }

  let dot = 0;
  const [small, large] = left.size < right.size ? [left, right] : [right, left];
  for (const [key, value] of small) {
    dot += value * (large.get(key) ?? 0);
  }
  return dot / leftNorm / rightNorm;
}

function denseNorm(vector: number[]) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function denseCosineSimilarity(
  left: number[],
  leftNorm: number,
  right: number[],
  rightNorm: number
) {
  if (!leftNorm || !rightNorm || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
  }
  return dot / leftNorm / rightNorm;
}

async function workspaceRoot(config: AiBackendConfig) {
  return realpath(config.workspaceRoot);
}

function modelRoot(config: AiBackendConfig) {
  return path.join(config.workspaceRoot, '.nota', 'models');
}

function searchCacheRoot(config: AiBackendConfig) {
  return path.join(config.workspaceRoot, '.nota', 'search');
}

function workspaceContentPath(config: AiBackendConfig) {
  return path.join(searchCacheRoot(config), 'workspace-content.json');
}

async function withWorkspaceContentMutation<T>(
  config: AiBackendConfig,
  mutation: () => Promise<T>
) {
  const key = workspaceContentPath(config);
  const previous = workspaceContentMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.catch(() => {}).then(() => gate);
  workspaceContentMutationQueues.set(key, queued);

  await previous.catch(() => {});
  try {
    return await mutation();
  } finally {
    release();
    if (workspaceContentMutationQueues.get(key) === queued) {
      workspaceContentMutationQueues.delete(key);
    }
  }
}

function workspaceContentReplacementKey(
  config: AiBackendConfig,
  workspaceId: string
) {
  return `${workspaceContentPath(config)}:${workspaceId}`;
}

function pruneWorkspaceContentReplacementSessions(now = Date.now()) {
  for (const [key, session] of workspaceContentReplacementSessions) {
    if (now - session.updatedAt > WORKSPACE_CONTENT_REPLACEMENT_TTL_MS) {
      workspaceContentReplacementSessions.delete(key);
    }
  }
}

function embeddingCachePath(config: AiBackendConfig, modelId: string) {
  const safeModelId = modelId.replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(searchCacheRoot(config), `${safeModelId}-embeddings.json`);
}

function embeddingModelId(config: AiBackendConfig) {
  const modelId = config.embeddingModel || DEFAULT_EMBEDDING_MODEL;
  return LEGACY_EMBEDDING_MODELS[modelId] ?? modelId;
}

function embeddingAllowsRemoteDownloads(config: AiBackendConfig) {
  return config.embeddingAllowRemote;
}

function availableRamGb() {
  return availableMemoryBytes() / 1024 / 1024 / 1024;
}

function neuralEmbeddingsEnabled(config: AiBackendConfig) {
  if (config.embeddingMode === 'fallback') {
    return false;
  }
  return !(
    config.embeddingMode === 'auto' &&
    availableRamGb() < NEURAL_EMBEDDING_MIN_AUTO_FREE_RAM_GB
  );
}

function neuralEmbeddingBatchSize(config: AiBackendConfig) {
  if (availableRamGb() < NEURAL_EMBEDDING_MIN_AUTO_FREE_RAM_GB) {
    return NEURAL_EMBEDDING_LOW_RAM_BATCH_SIZE;
  }
  return config.embeddingMode === 'semantic'
    ? NEURAL_EMBEDDING_STANDARD_BATCH_SIZE
    : NEURAL_EMBEDDING_LOW_RAM_BATCH_SIZE;
}

function clearEmbeddingPipelines() {
  for (const key of embeddingPipelines.keys()) {
    if (!embeddingPipelineUsers.get(key)) retireEmbeddingPipeline(key);
  }
}

function retireEmbeddingPipeline(cacheKey: string) {
  const pending = embeddingPipelines.get(cacheKey);
  embeddingPipelines.delete(cacheKey);
  clearTimeout(embeddingPipelineUnloadTimers.get(cacheKey));
  embeddingPipelineUnloadTimers.delete(cacheKey);
  if (pending) {
    pending.then(pipeline => pipeline.dispose?.()).catch(() => {});
  }
}

function acquireEmbeddingPipeline(cacheKey: string) {
  clearTimeout(embeddingPipelineUnloadTimers.get(cacheKey));
  embeddingPipelineUnloadTimers.delete(cacheKey);
  embeddingPipelineUsers.set(
    cacheKey,
    (embeddingPipelineUsers.get(cacheKey) ?? 0) + 1
  );
}

function scheduleEmbeddingPipelineUnload(cacheKey: string) {
  const users = Math.max(0, (embeddingPipelineUsers.get(cacheKey) ?? 1) - 1);
  if (users) {
    embeddingPipelineUsers.set(cacheKey, users);
    return;
  }
  embeddingPipelineUsers.delete(cacheKey);
  const existing = embeddingPipelineUnloadTimers.get(cacheKey);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    retireEmbeddingPipeline(cacheKey);
  }, NEURAL_EMBEDDING_IDLE_TTL_MS);
  timer.unref?.();
  embeddingPipelineUnloadTimers.set(cacheKey, timer);
}

function contentHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function embeddingText(chunk: WorkspaceSearchChunk) {
  return `${chunk.title}\n${chunk.docId}\n${chunk.content}`;
}

function cacheEntryKey(entry: Pick<EmbeddingCacheEntry, 'id' | 'docId'>) {
  return `${entry.docId}:${entry.id}`;
}

function validCachedVector(value: unknown) {
  return Array.isArray(value) &&
    value.length >= 8 &&
    value.every(item => typeof item === 'number' && Number.isFinite(item)) &&
    denseNorm(value) > 0 &&
    Number.isFinite(denseNorm(value))
    ? (value as number[])
    : [];
}

async function readEmbeddingCache(config: AiBackendConfig, modelId: string) {
  try {
    const parsed = JSON.parse(
      await readFile(embeddingCachePath(config, modelId), 'utf8')
    ) as EmbeddingCacheFile;
    if (parsed.version !== 1 || parsed.modelId !== modelId) {
      return new Map<string, EmbeddingCacheEntry>();
    }

    const entries = new Map<string, EmbeddingCacheEntry>();
    for (const entry of parsed.entries ?? []) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        typeof entry.docId !== 'string' ||
        typeof entry.contentHash !== 'string'
      ) {
        continue;
      }
      const vector = validCachedVector(entry.vector);
      if (vector.length < 8) {
        continue;
      }
      entries.set(cacheEntryKey(entry), {
        contentHash: entry.contentHash,
        docId: entry.docId,
        id: entry.id,
        updatedAt:
          typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
        vector,
      });
    }
    return entries;
  } catch {
    return new Map<string, EmbeddingCacheEntry>();
  }
}

async function writeEmbeddingCache(
  config: AiBackendConfig,
  modelId: string,
  entries: EmbeddingCacheEntry[]
) {
  const ordered = entries
    .slice()
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, MAX_EMBEDDING_CACHE_ENTRIES);
  const filePath = embeddingCachePath(config, modelId);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    temporaryPath,
    JSON.stringify(
      {
        entries: ordered,
        modelId,
        updatedAt: new Date().toISOString(),
        version: 1,
      } satisfies EmbeddingCacheFile,
      null,
      2
    )
  );
  try {
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function normalizeStoredSource(
  value: unknown,
  fallback: WorkspaceSearchResult['source'] = 'doc'
) {
  return value === 'doc' ||
    value === 'transcript' ||
    value === 'attachment' ||
    value === 'web'
    ? value
    : fallback;
}

function normalizeVisibility(value: unknown): WorkspaceContentVisibility {
  return value === 'private' ? 'private' : 'workspace';
}

function normalizeAllowedUserIds(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const userIds = [
    ...new Set(
      value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    ),
  ];
  return userIds.length ? userIds : undefined;
}

function readStoredContentDocument(
  value: unknown
): StoredWorkspaceContentDocument | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.workspaceId !== 'string' ||
    typeof record.docId !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.markdown !== 'string'
  ) {
    return null;
  }
  return {
    allowedUserIds: normalizeAllowedUserIds(record.allowedUserIds),
    docId: record.docId,
    markdown: record.markdown,
    source: normalizeStoredSource(record.source),
    title: record.title,
    updatedAt:
      typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    visibility: normalizeVisibility(record.visibility),
    workspaceId: record.workspaceId,
  };
}

async function readWorkspaceContent(config: AiBackendConfig) {
  try {
    const parsed = JSON.parse(
      await readFile(workspaceContentPath(config), 'utf8')
    ) as WorkspaceContentFile;
    if (parsed.version !== 1) {
      return [];
    }
    return (parsed.documents ?? [])
      .map(readStoredContentDocument)
      .filter(
        (document): document is StoredWorkspaceContentDocument => !!document
      );
  } catch {
    return [];
  }
}

function requiredDocumentScope(
  value: string | null | undefined,
  field: 'userId' | 'workspaceId'
) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required to access Nota workspace content.`);
  }
  return normalized;
}

function workspaceDocumentRef(document: StoredWorkspaceContentDocument) {
  return `nota://${document.workspaceId}/${document.docId}`;
}

function toWorkspaceDocumentSummary(
  document: StoredWorkspaceContentDocument
): WorkspaceDocumentSummary {
  return {
    docId: document.docId,
    source: document.source,
    sourceRef: workspaceDocumentRef(document),
    title: document.title,
    updatedAt: document.updatedAt,
    workspaceId: document.workspaceId,
  };
}

function readableWorkspaceDocuments(
  documents: StoredWorkspaceContentDocument[],
  input: WorkspaceDocumentAccessInput
) {
  const userId = requiredDocumentScope(input.userId, 'userId');
  const workspaceId = requiredDocumentScope(input.workspaceId, 'workspaceId');
  return documents.filter(
    document =>
      document.workspaceId === workspaceId &&
      canReadWorkspaceContent(document, workspaceId, userId)
  );
}

export async function listWorkspaceDocuments(
  config: AiBackendConfig,
  input: WorkspaceDocumentListInput
) {
  const query = normalizeQuery(input.query ?? '').toLowerCase();
  const documents = readableWorkspaceDocuments(
    await readWorkspaceContent(config),
    input
  )
    .filter(document => {
      if (!query) return true;
      return `${document.title}\n${document.docId}\n${document.source}`
        .toLowerCase()
        .includes(query);
    })
    .sort(
      (left, right) =>
        (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') ||
        left.title.localeCompare(right.title) ||
        left.docId.localeCompare(right.docId)
    );
  const limit = clampLimit(input.limit);

  return {
    documents: documents.slice(0, limit).map(toWorkspaceDocumentSummary),
    total: documents.length,
    workspaceId: requiredDocumentScope(input.workspaceId, 'workspaceId'),
  };
}

export async function readWorkspaceDocument(
  config: AiBackendConfig,
  input: WorkspaceDocumentReadInput
) {
  const docId = input.docId.trim();
  if (!docId) {
    throw new Error('docId is required to read Nota workspace content.');
  }
  const document = readableWorkspaceDocuments(
    await readWorkspaceContent(config),
    input
  ).find(candidate => candidate.docId === docId);
  if (!document) {
    throw new Error('Nota document was not found or is not accessible.');
  }

  return {
    document: {
      ...toWorkspaceDocumentSummary(document),
      markdown: document.markdown,
    } satisfies WorkspaceDocument,
  };
}

async function writeWorkspaceContent(
  config: AiBackendConfig,
  documents: StoredWorkspaceContentDocument[]
) {
  const filePath = workspaceContentPath(config);
  const temporaryPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    temporaryPath,
    JSON.stringify(
      {
        documents,
        updatedAt: new Date().toISOString(),
        version: 1,
      } satisfies WorkspaceContentFile,
      null,
      2
    )
  );
  await rename(temporaryPath, filePath);
}

function readWorkspaceContentReplacementInput(
  value: unknown
): WorkspaceContentReplacementInput | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== 'object') {
    throw new Error('replacement must be an object.');
  }

  const record = value as Record<string, unknown>;
  const syncId = typeof record.syncId === 'string' ? record.syncId.trim() : '';
  if (!syncId || syncId.length > 200) {
    throw new Error('replacement.syncId is required.');
  }
  if (
    typeof record.page !== 'number' ||
    !Number.isSafeInteger(record.page) ||
    record.page < 0
  ) {
    throw new Error('replacement.page must be a non-negative integer.');
  }
  if (typeof record.complete !== 'boolean') {
    throw new Error('replacement.complete must be a boolean.');
  }

  return {
    complete: record.complete,
    page: record.page,
    syncId,
  };
}

function readWorkspaceContentDocumentInput(
  value: unknown,
  requireAccessVerification: boolean
): WorkspaceContentDocumentInput | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (requireAccessVerification && record.accessVerified !== true) {
    return null;
  }
  if (
    typeof record.docId !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.markdown !== 'string'
  ) {
    return null;
  }
  const markdown = record.markdown.trim();
  if (!record.docId.trim() || !markdown) {
    return null;
  }
  return {
    accessVerified: record.accessVerified === true,
    allowedUserIds: normalizeAllowedUserIds(record.allowedUserIds),
    docId: record.docId.trim(),
    markdown,
    source: normalizeStoredSource(record.source, 'doc'),
    title: record.title.trim() || record.docId.trim(),
    updatedAt:
      typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    visibility: normalizeVisibility(record.visibility),
  };
}

export async function upsertWorkspaceContentDocuments(
  config: AiBackendConfig,
  input: {
    documents: unknown;
    replacement?: unknown;
    replaceWorkspace?: boolean;
    requireAccessVerification?: boolean;
    workspaceId: string;
  }
) {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error('workspaceId is required.');
  }
  if (!Array.isArray(input.documents)) {
    throw new Error('documents must be an array.');
  }
  const replacement = readWorkspaceContentReplacementInput(input.replacement);
  if (input.replaceWorkspace && !replacement) {
    throw new Error(
      'Paged replacement metadata is required to replace a workspace index.'
    );
  }
  const documents = input.documents
    .map(document =>
      readWorkspaceContentDocumentInput(
        document,
        input.requireAccessVerification === true
      )
    )
    .filter(
      (document): document is WorkspaceContentDocumentInput => !!document
    );
  if (documents.length !== input.documents.length) {
    throw new Error(
      input.requireAccessVerification
        ? 'Every indexed document must be valid and have verified read access.'
        : 'Every indexed document must be valid.'
    );
  }

  return withWorkspaceContentMutation(config, async () => {
    pruneWorkspaceContentReplacementSessions();
    const existing = await readWorkspaceContent(config);
    const byKey = new Map(
      existing.map(document => [
        `${document.workspaceId}:${document.docId}`,
        document,
      ])
    );
    const replacementKey = workspaceContentReplacementKey(config, workspaceId);
    const activeReplacement =
      workspaceContentReplacementSessions.get(replacementKey);
    let nextReplacement: WorkspaceContentReplacementSession | null = null;

    if (replacement) {
      if (replacement.page === 0) {
        nextReplacement = {
          nextPage: 1,
          seenDocIds: new Set<string>(),
          syncId: replacement.syncId,
          updatedAt: Date.now(),
        };
      } else {
        if (
          !activeReplacement ||
          activeReplacement.syncId !== replacement.syncId ||
          activeReplacement.nextPage !== replacement.page
        ) {
          throw new Error(
            'Workspace replacement pages must arrive in order for the active sync.'
          );
        }
        nextReplacement = {
          ...activeReplacement,
          nextPage: replacement.page + 1,
          seenDocIds: new Set(activeReplacement.seenDocIds),
          updatedAt: Date.now(),
        };
      }
    }

    for (const document of documents) {
      const { accessVerified: _accessVerified, ...storedDocument } = document;
      byKey.set(`${workspaceId}:${document.docId}`, {
        ...storedDocument,
        source: document.source ?? 'doc',
        visibility: document.visibility ?? 'workspace',
        workspaceId,
      });
      nextReplacement?.seenDocIds.add(document.docId);
    }

    let removed = 0;
    if (replacement?.complete && nextReplacement) {
      for (const [key, existingDocument] of byKey) {
        if (
          existingDocument.workspaceId === workspaceId &&
          !nextReplacement.seenDocIds.has(existingDocument.docId)
        ) {
          byKey.delete(key);
          removed++;
        }
      }
    }

    await writeWorkspaceContent(config, [...byKey.values()]);
    if (replacement?.complete) {
      workspaceContentReplacementSessions.delete(replacementKey);
    } else if (nextReplacement) {
      workspaceContentReplacementSessions.set(replacementKey, nextReplacement);
    }
    indexCache.clear();
    indexRevision++;
    return {
      indexed: documents.length,
      removed,
      replacement: replacement
        ? {
            complete: replacement.complete,
            nextPage: replacement.complete ? null : replacement.page + 1,
            syncId: replacement.syncId,
          }
        : undefined,
      total: byKey.size,
      workspaceId,
    };
  });
}

export async function deleteWorkspaceContentDocuments(
  config: AiBackendConfig,
  input: {
    docIds: string[];
    workspaceId: string;
  }
) {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error('workspaceId is required.');
  }
  const docIds = new Set(
    input.docIds.map(docId => docId.trim()).filter(Boolean)
  );
  if (!docIds.size) {
    return {
      removed: 0,
      total: (await readWorkspaceContent(config)).length,
      workspaceId,
    };
  }

  return withWorkspaceContentMutation(config, async () => {
    const existing = await readWorkspaceContent(config);
    const next = existing.filter(
      document =>
        document.workspaceId !== workspaceId || !docIds.has(document.docId)
    );
    const removed = existing.length - next.length;
    if (removed) {
      await writeWorkspaceContent(config, next);
      indexCache.clear();
      indexRevision++;
    }
    return {
      removed,
      total: next.length,
      workspaceId,
    };
  });
}

async function loadEmbeddingPipeline(config: AiBackendConfig) {
  if (!neuralEmbeddingsEnabled(config)) {
    clearEmbeddingPipelines();
    return null;
  }

  const modelId = embeddingModelId(config);
  const cacheKey = `${modelRoot(config)}:${modelId}:${
    embeddingAllowsRemoteDownloads(config) ? 'remote' : 'local'
  }`;
  const failedAt = embeddingFailures.get(cacheKey);
  if (failedAt && Date.now() - failedAt < NEURAL_EMBEDDING_FAILURE_TTL_MS) {
    return null;
  }

  const existing = embeddingPipelines.get(cacheKey);
  acquireEmbeddingPipeline(cacheKey);
  if (existing) {
    try {
      return {
        cacheKey,
        modelId,
        pipeline: await existing,
      };
    } catch {
      scheduleEmbeddingPipelineUnload(cacheKey);
      return null;
    }
  }

  const pending = (async () => {
    const allowRemote = embeddingAllowsRemoteDownloads(config);
    const transformers = await embeddingLoader();

    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = allowRemote;
    transformers.env.localModelPath = modelRoot(config);

    return transformers.pipeline('feature-extraction', modelId, {
      device: 'cpu',
      local_files_only: !allowRemote,
    });
  })();

  embeddingPipelines.set(cacheKey, pending);
  pending.catch(() => {
    embeddingPipelines.delete(cacheKey);
    embeddingFailures.set(cacheKey, Date.now());
  });

  try {
    return {
      cacheKey,
      modelId,
      pipeline: await pending,
    };
  } catch {
    scheduleEmbeddingPipelineUnload(cacheKey);
    return null;
  }
}

function vectorsFromTensor(output: unknown, expectedCount: number) {
  const withToList = output as { tolist?: () => unknown };
  const listed =
    typeof withToList?.tolist === 'function' ? withToList.tolist() : output;

  if (!Array.isArray(listed)) {
    return null;
  }

  const rows =
    expectedCount === 1 && listed.every(item => typeof item === 'number')
      ? [listed]
      : listed;

  const vectors = rows.map(validCachedVector);

  if (
    vectors.length !== expectedCount ||
    vectors.some(
      vector => vector.length < 8 || vector.length !== vectors[0].length
    )
  ) {
    return null;
  }
  return vectors;
}

async function embedTexts(config: AiBackendConfig, texts: string[]) {
  if (!texts.length) {
    return null;
  }

  const loaded = await loadEmbeddingPipeline(config);
  if (!loaded) {
    return null;
  }

  const vectors: number[][] = [];
  try {
    const batchSize = neuralEmbeddingBatchSize(config);
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const output = await loaded.pipeline(batch, {
        normalize: true,
        pooling: 'mean',
      });
      const batchVectors = vectorsFromTensor(output, batch.length);
      if (!batchVectors) {
        return null;
      }
      vectors.push(...batchVectors);
    }
  } catch {
    return null;
  } finally {
    scheduleEmbeddingPipelineUnload(loaded.cacheKey);
  }

  return {
    modelId: loaded.modelId,
    vectors,
  };
}

export async function probeEmbeddingModel(
  config: AiBackendConfig,
  modelId = embeddingModelId(config)
) {
  const loaded = await loadEmbeddingPipeline({
    ...config,
    embeddingAllowRemote: false,
    embeddingMode: 'semantic',
    embeddingModel: modelId,
  });
  if (!loaded) {
    throw new Error('Local embedding pipeline could not be loaded.');
  }

  try {
    const output = await loaded.pipeline(['Nota local embedding probe'], {
      normalize: true,
      pooling: 'mean',
    });
    const vectors = vectorsFromTensor(output, 1);
    const dimensions = vectors?.[0]?.length ?? 0;
    if (dimensions < 8) {
      throw new Error('Local embedding pipeline returned an invalid vector.');
    }
    return {
      dimensions,
      modelId: loaded.modelId,
    };
  } finally {
    scheduleEmbeddingPipelineUnload(loaded.cacheKey);
  }
}

function sourceRef(docId: string, blockId?: string) {
  return `${docId}${blockId ? `#${blockId}` : ''}`;
}

function citationKind(input: {
  blockId?: string;
  source: WorkspaceSearchResult['source'];
}): WorkspaceSearchCitationKind {
  if (input.source === 'transcript') {
    return 'meeting-transcript';
  }
  if (input.source === 'attachment') {
    return 'attachment';
  }
  if (input.source === 'web') {
    return 'web';
  }
  if (input.blockId?.startsWith('table-row:')) {
    return 'table-row';
  }
  if (input.blockId?.startsWith('line:')) {
    return 'line-range';
  }
  return 'document';
}

function citationFor(input: {
  blockId?: string;
  docId: string;
  endLine?: number;
  section?: string;
  source: WorkspaceSearchResult['source'];
  startLine?: number;
  title: string;
  updatedAt?: string;
  workspaceId: string;
}): WorkspaceSearchCitation {
  const ref = sourceRef(input.docId, input.blockId);
  return {
    blockId: input.blockId,
    docId: input.docId,
    endLine: input.endLine,
    kind: citationKind(input),
    label: `${input.title}${
      input.section ? ` / ${input.section}` : ''
    } [source: ${ref}]`,
    ref,
    section: input.section,
    source: input.source,
    startLine: input.startLine,
    title: input.title,
    updatedAt: input.updatedAt,
    workspaceId: input.workspaceId,
  };
}

function trimSnippet(content: string) {
  const snippet = content.trim();
  return snippet.length > MAX_SNIPPET_CHARS
    ? `${snippet.slice(0, MAX_SNIPPET_CHARS)}\n[truncated]`
    : snippet;
}

function scoreMatch(snippet: string, terms: string[], lineNumber: number) {
  const lower = snippet.toLowerCase();
  const termHits = terms.reduce(
    (score, term) => score + (lower.includes(term) ? 1 : 0),
    0
  );
  const density = terms.length ? termHits / terms.length : 0;
  const earlyLineBoost = termHits > 0 && lineNumber <= 20 ? 0.1 : 0;
  return Number((density + termHits * 0.2 + earlyLineBoost).toFixed(4));
}

function chunkFile(relativePath: string, content: string) {
  const lines = content.split(/\r?\n/);
  const chunks: Array<{
    blockId?: string;
    content: string;
    endLine: number;
    id: string;
    section?: string;
    startLine: number;
  }> = [];
  const sectionByLine = sectionMapForLines(lines);

  for (
    let start = 0;
    start < lines.length;
    start += CHUNK_LINE_COUNT - CHUNK_LINE_OVERLAP
  ) {
    const end = Math.min(lines.length, start + CHUNK_LINE_COUNT);
    const content = lines
      .slice(start, end)
      .map((line, offset) => `${start + offset + 1}: ${line}`)
      .join('\n')
      .trim();
    if (content.length < 20) {
      continue;
    }
    chunks.push({
      content,
      endLine: end,
      id: `${relativePath}#line:${start + 1}-${end}`,
      section: sectionForRange(sectionByLine, start + 1, end),
      startLine: start + 1,
    });
  }

  chunks.push(...chunkMarkdownTables(relativePath, lines, sectionByLine));
  return chunks;
}

function sectionMapForLines(lines: string[]) {
  const sections: Array<string | undefined> = [];
  const stack: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (heading) {
      const depth = heading[1].length;
      stack.length = depth - 1;
      stack[depth - 1] = heading[2].replace(/\s+#+$/, '').trim();
    }
    sections[index] = stack.filter(Boolean).join(' / ') || undefined;
  }

  return sections;
}

function sectionForRange(
  sectionByLine: Array<string | undefined>,
  startLine: number,
  endLine: number
) {
  const counts = new Map<string, number>();
  for (let line = startLine; line <= endLine; line++) {
    const section = sectionByLine[line - 1];
    if (!section) {
      continue;
    }
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return (
    cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return [];
  }
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of withoutEdges) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function chunkMarkdownTables(
  relativePath: string,
  lines: string[],
  sectionByLine: Array<string | undefined>
) {
  const chunks: Array<{
    blockId?: string;
    content: string;
    endLine: number;
    id: string;
    section?: string;
    startLine: number;
  }> = [];

  for (let index = 0; index < lines.length - 1; index++) {
    const headers = splitMarkdownTableRow(lines[index]);
    if (headers.length < 2 || !isMarkdownTableSeparator(lines[index + 1])) {
      continue;
    }

    let rowIndex = index + 2;
    while (rowIndex < lines.length) {
      const values = splitMarkdownTableRow(lines[rowIndex]);
      if (values.length < 2) {
        break;
      }

      const rowText = headers
        .map((header, headerIndex) => {
          const value = values[headerIndex] ?? '';
          return `${header || `Column ${headerIndex + 1}`}: ${value || '-'}`;
        })
        .join('\n');
      chunks.push({
        blockId: `table-row:${rowIndex + 1}`,
        content: [
          `Database/table row from ${relativePath}`,
          `Line ${rowIndex + 1}`,
          rowText,
        ].join('\n'),
        endLine: rowIndex + 1,
        id: `${relativePath}#table-row:${rowIndex + 1}`,
        section: sectionByLine[rowIndex],
        startLine: rowIndex + 1,
      });
      rowIndex++;
    }

    index = Math.max(index, rowIndex - 1);
  }

  return chunks;
}

function pushChunk(
  chunks: WorkspaceSearchChunk[],
  input: {
    content: string;
    docId: string;
    endLine: number;
    id: string;
    allowedUserIds?: string[];
    blockId?: string;
    section?: string;
    source: WorkspaceSearchResult['source'];
    startLine: number;
    title: string;
    updatedAt?: string;
    visibility?: WorkspaceContentVisibility;
    workspaceId?: string;
  }
) {
  const { norm, vector } = vectorize(
    `${input.title}\n${input.docId}\n${input.content}`
  );
  chunks.push({
    blockId: input.blockId,
    content: input.content,
    docId: input.docId,
    endLine: input.endLine,
    id: input.id,
    allowedUserIds: input.allowedUserIds,
    section: input.section,
    source: input.source,
    startLine: input.startLine,
    title: input.title,
    updatedAt: input.updatedAt,
    vector,
    vectorNorm: norm,
    visibility: input.visibility ?? 'workspace',
    workspaceId: input.workspaceId,
  });
}

async function attachNeuralEmbeddings(
  config: AiBackendConfig,
  chunks: WorkspaceSearchChunk[]
) {
  if (!neuralEmbeddingsEnabled(config)) {
    return null;
  }

  const modelId = embeddingModelId(config);
  const cache = await readEmbeddingCache(config, modelId);
  const missing: Array<{
    contentHash: string;
    chunk: WorkspaceSearchChunk;
    text: string;
  }> = [];
  let hits = 0;

  for (const chunk of chunks) {
    const text = embeddingText(chunk);
    const hash = contentHash(text);
    const cached = cache.get(cacheEntryKey(chunk));
    if (cached?.contentHash === hash) {
      chunk.denseVector = cached.vector;
      chunk.denseVectorNorm = denseNorm(cached.vector);
      chunk.embeddingModel = modelId;
      hits++;
      continue;
    }

    missing.push({
      chunk,
      contentHash: hash,
      text,
    });
  }

  const embeddings = missing.length
    ? await embedTexts(
        config,
        missing.map(item => item.text)
      )
    : null;

  if (missing.length && !embeddings) {
    return hits
      ? {
          cacheHits: hits,
          cacheMisses: missing.length,
          dimensions: chunks.find(chunk => chunk.denseVector)?.denseVector
            ?.length,
          modelId,
        }
      : null;
  }

  if (embeddings) {
    for (let index = 0; index < missing.length; index++) {
      const vector = embeddings.vectors[index];
      const chunk = missing[index].chunk;
      chunk.denseVector = vector;
      chunk.denseVectorNorm = denseNorm(vector);
      chunk.embeddingModel = embeddings.modelId;
      cache.set(cacheEntryKey(chunk), {
        contentHash: missing[index].contentHash,
        docId: chunk.docId,
        id: chunk.id,
        updatedAt: chunk.updatedAt,
        vector,
      });
    }
    await writeEmbeddingCache(config, embeddings.modelId, [
      ...cache.values(),
    ]).catch(() => {});
  }

  const firstDenseVector = chunks.find(chunk => chunk.denseVector)?.denseVector;
  return {
    cacheHits: hits,
    cacheMisses: missing.length,
    dimensions: firstDenseVector?.length ?? 0,
    modelId: embeddings?.modelId ?? modelId,
  };
}

async function buildWorkspaceIndex(
  config: AiBackendConfig,
  root: string,
  workspaceId: string,
  userId: string
): Promise<WorkspaceSearchIndex> {
  const now = Date.now();
  for (const [key, index] of indexCache) {
    if (now - index.builtAt >= INDEX_CACHE_TTL_MS) indexCache.delete(key);
  }
  const revision = indexRevision;
  const cacheKey = `${root}:nota-content:${embeddingModelId(config)}:${
    embeddingAllowsRemoteDownloads(config) ? 'remote' : 'local'
  }:${config.embeddingMode}:${JSON.stringify([workspaceId, userId])}:${revision}`;
  const cached = indexCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const existingBuild = indexBuilds.get(cacheKey);
  if (existingBuild) return existingBuild;
  const pending = (async () => {
    // Only renderer-indexed Nota documents enter retrieval. The backend root is
    // app infrastructure (settings, model caches, logs, auth state), not a user
    // workspace, and scanning it could mix unrelated local data into answers or
    // hosted prompts. Attachments and meeting transcripts arrive through this
    // same access-checked content store with their explicit source metadata.
    const storedDocuments = readableWorkspaceDocuments(
      await readWorkspaceContent(config),
      { workspaceId, userId }
    );
    const chunks: WorkspaceSearchChunk[] = [];

    for (const document of storedDocuments) {
      for (const chunk of chunkFile(document.docId, document.markdown)) {
        pushChunk(chunks, {
          content: chunk.content,
          allowedUserIds: document.allowedUserIds,
          blockId: chunk.blockId,
          docId: document.docId,
          endLine: chunk.endLine,
          id: chunk.blockId
            ? `nota://${document.workspaceId}/${document.docId}#${chunk.blockId}`
            : `nota://${document.workspaceId}/${document.docId}#line:${chunk.startLine}-${chunk.endLine}`,
          section: chunk.section,
          source: document.source,
          startLine: chunk.startLine,
          title: document.title,
          updatedAt: document.updatedAt,
          visibility: document.visibility,
          workspaceId: document.workspaceId,
        });
      }
    }

    const embedding = await attachNeuralEmbeddings(config, chunks);
    const index: WorkspaceSearchIndex = {
      builtAt: Date.now(),
      chunks,
      embeddingCacheHits: embedding?.cacheHits,
      embeddingCacheMisses: embedding?.cacheMisses,
      embeddingDimensions: embedding?.dimensions,
      embeddingModel: embedding?.modelId,
      files: storedDocuments.length,
      root,
    };
    if (revision === indexRevision) {
      indexCache.set(cacheKey, index);
      while (indexCache.size > MAX_INDEX_CACHE_ENTRIES) {
        const oldestKey = indexCache.keys().next().value;
        if (oldestKey === undefined) break;
        indexCache.delete(oldestKey);
      }
    }
    return index;
  })();
  indexBuilds.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    indexBuilds.delete(cacheKey);
  }
}

async function vectorSearch(
  config: AiBackendConfig,
  root: string,
  query: string,
  limit: number,
  userId: string,
  workspaceId: string,
  retries = 0
): Promise<{
  index: {
    builtAt: string;
    chunks: number;
    embeddingCacheHits?: number;
    embeddingCacheMisses?: number;
    embeddingDimensions?: number;
    embeddingModel?: string;
    files: number;
    vectorDimensions: number;
  };
  results: WorkspaceSearchResult[];
  searchType: SearchType;
}> {
  const revision = indexRevision;
  const index = await buildWorkspaceIndex(config, root, workspaceId, userId);
  const terms = queryTerms(query);
  const queryVector = vectorize(query);
  const queryEmbedding =
    index.embeddingModel && index.embeddingDimensions
      ? await embedTexts(config, [query])
      : null;
  const queryDenseVector =
    queryEmbedding && queryEmbedding.modelId === index.embeddingModel
      ? queryEmbedding.vectors[0]
      : null;
  const queryDenseNorm = queryDenseVector ? denseNorm(queryDenseVector) : 0;
  if (revision !== indexRevision) {
    if (retries >= 2) {
      throw new Error(
        'Workspace content changed during search. Please retry the search.'
      );
    }
    return vectorSearch(
      config,
      root,
      query,
      limit,
      userId,
      workspaceId,
      retries + 1
    );
  }
  const usesNeuralEmbedding = !!queryDenseVector;
  const results = index.chunks
    .filter(chunk => canReadWorkspaceContent(chunk, workspaceId, userId))
    .map(chunk => {
      const chunkDenseVector = chunk.denseVector;
      const chunkDenseNorm = chunk.denseVectorNorm;
      const hasDenseVector =
        !!queryDenseVector &&
        !!chunkDenseVector &&
        queryDenseVector.length === chunkDenseVector.length &&
        typeof chunkDenseNorm === 'number';
      const vectorScore = hasDenseVector
        ? denseCosineSimilarity(
            queryDenseVector,
            queryDenseNorm,
            chunkDenseVector,
            chunkDenseNorm
          )
        : cosineSimilarity(
            queryVector.vector,
            queryVector.norm,
            chunk.vector,
            chunk.vectorNorm
          );
      const lexicalScore = scoreMatch(chunk.content, terms, chunk.startLine);
      const score = Number(
        (
          vectorScore * (hasDenseVector ? 0.82 : 0.74) +
          lexicalScore * (hasDenseVector ? 0.18 : 0.26)
        ).toFixed(4)
      );
      const matched = hasDenseVector || lexicalScore > 0 || vectorScore >= 0.42;
      const blockId = chunk.blockId ?? `line:${chunk.startLine}`;
      const citation = citationFor({
        blockId,
        docId: chunk.docId,
        endLine: chunk.endLine,
        section: chunk.section,
        source: chunk.source,
        startLine: chunk.startLine,
        title: chunk.title,
        updatedAt: chunk.updatedAt,
        workspaceId,
      });
      return {
        blockId,
        citation,
        docId: chunk.docId,
        endLine: chunk.endLine,
        id: chunk.id,
        matched,
        score,
        section: chunk.section,
        snippet: trimSnippet(chunk.content),
        source: chunk.source,
        sourceRef: citation.ref,
        startLine: chunk.startLine,
        title: chunk.title,
        updatedAt: chunk.updatedAt,
        workspaceId,
      };
    })
    .filter(result => result.matched && result.score > 0)
    .sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId))
    .slice(0, limit)
    .map(({ matched: _matched, ...result }) => result);

  return {
    index: {
      builtAt: new Date(index.builtAt).toISOString(),
      chunks: index.chunks.length,
      embeddingCacheHits: index.embeddingCacheHits,
      embeddingCacheMisses: index.embeddingCacheMisses,
      embeddingDimensions: index.embeddingDimensions,
      embeddingModel: index.embeddingModel,
      files: index.files,
      vectorDimensions: MAX_VECTOR_FEATURES,
    },
    results,
    searchType: usesNeuralEmbedding
      ? ('local-neural-embedding' as SearchType)
      : ('local-hash-embedding' as SearchType),
  };
}

function canReadWorkspaceContent(
  content: Pick<
    WorkspaceSearchChunk,
    'allowedUserIds' | 'visibility' | 'workspaceId'
  >,
  workspaceId: string,
  userId: string
) {
  if (content.workspaceId && content.workspaceId !== workspaceId) {
    return false;
  }
  if (content.visibility === 'private') {
    return !!content.allowedUserIds?.includes(userId);
  }
  if (content.allowedUserIds?.length) {
    return content.allowedUserIds.includes(userId);
  }
  return true;
}

export async function searchWorkspace(
  config: AiBackendConfig,
  input: WorkspaceSearchInput
) {
  const query = normalizeQuery(input.query);
  if (!query) {
    throw new Error('Workspace search query is required.');
  }

  const root = await workspaceRoot(config);
  const limit = clampLimit(input.limit);
  const workspaceId = requiredDocumentScope(input.workspaceId, 'workspaceId');
  const userId = requiredDocumentScope(input.userId, 'userId');
  const vector = await vectorSearch(
    config,
    root,
    query,
    limit,
    userId,
    workspaceId
  );
  return {
    index: vector.index,
    query,
    results: vector.results,
    searchType: vector.searchType,
    workspaceRoot: root,
  };
}
