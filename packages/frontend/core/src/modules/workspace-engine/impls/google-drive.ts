import { toArrayBuffer } from '@nota/core/utils/array-buffer';
import { DebugLogger } from '@nota/debug';
import type { FrameworkProvider } from '@nota/infra';
import { LiveData, Service } from '@nota/infra';
import {
  type BlobStorage,
  type DocStorage,
  type ListedBlobRecord,
} from '@nota/nbstore';
import {
  driveQueryValue,
  GoogleDriveConnection,
  type GoogleDriveTokens,
} from '@nota/nbstore/google-drive';
import {
  IndexedDBBlobStorage,
  IndexedDBBlobSyncStorage,
  IndexedDBDocStorage,
  IndexedDBDocSyncStorage,
  IndexedDBIndexerStorage,
  IndexedDBIndexerSyncStorage,
} from '@nota/nbstore/idb';
import {
  SqliteBlobStorage,
  SqliteBlobSyncStorage,
  SqliteDocStorage,
  SqliteDocSyncStorage,
  SqliteIndexerStorage,
  SqliteIndexerSyncStorage,
} from '@nota/nbstore/sqlite';
import type { WorkerInitOptions } from '@nota/nbstore/worker/client';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { Doc as YDoc, encodeStateAsUpdate } from 'yjs';

import { GoogleAuthService } from '../../google-auth';
import type {
  WorkspaceFlavourProvider,
  WorkspaceFlavoursProvider,
  WorkspaceMetadata,
  WorkspaceProfileInfo,
} from '../../workspace';
import { WorkspaceImpl } from '../../workspace/impls/workspace';
import { getWorkspaceProfileWorker } from './out-worker';
import {
  dedupeWorkspaceIds,
  normalizeWorkspaceIds,
} from './workspace-id-utils';

const GOOGLE_DRIVE_WORKSPACE_LOCAL_STORAGE_KEY = 'nota-google-drive-workspaces';
const GOOGLE_DRIVE_WORKSPACE_METADATA_LOCAL_STORAGE_KEY =
  'nota-google-drive-workspace-metadata';
const GOOGLE_DRIVE_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY =
  'nota-google-drive-workspace-changed';
const GOOGLE_DRIVE_DEVICE_ID_KEY = 'nota:gdrive:deviceId';

const logger = new DebugLogger('google-drive-workspace');

type GoogleDriveWorkerTokens = GoogleDriveTokens;

type GoogleDriveWorkspaceMeta = {
  id: string;
  accountId?: string;
  syncPaused?: boolean;
  hidden?: boolean;
  name?: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
};

export function getGoogleDriveWorkspaceIds(): string[] {
  try {
    return normalizeWorkspaceIds(
      JSON.parse(
        localStorage.getItem(GOOGLE_DRIVE_WORKSPACE_LOCAL_STORAGE_KEY) ?? '[]'
      )
    );
  } catch (e) {
    logger.error('Failed to get google drive workspace ids', e);
    return [];
  }
}

export function setGoogleDriveWorkspaceIds(
  idsOrUpdater: string[] | ((ids: string[]) => string[])
) {
  const next = normalizeWorkspaceIds(
    typeof idsOrUpdater === 'function'
      ? idsOrUpdater(getGoogleDriveWorkspaceIds())
      : idsOrUpdater
  );
  const deduplicated = dedupeWorkspaceIds(next);

  try {
    localStorage.setItem(
      GOOGLE_DRIVE_WORKSPACE_LOCAL_STORAGE_KEY,
      JSON.stringify(deduplicated)
    );
  } catch (e) {
    logger.error('Failed to set google drive workspace ids', e);
  }
}

function getGoogleDriveWorkspaceMetadata() {
  try {
    const raw = localStorage.getItem(
      GOOGLE_DRIVE_WORKSPACE_METADATA_LOCAL_STORAGE_KEY
    );
    if (!raw) {
      return {} as Record<string, GoogleDriveWorkspaceMeta>;
    }
    return JSON.parse(raw) as Record<string, GoogleDriveWorkspaceMeta>;
  } catch (e) {
    logger.error('Failed to get google drive workspace metadata', e);
    return {} as Record<string, GoogleDriveWorkspaceMeta>;
  }
}

function setGoogleDriveWorkspaceMetadata(
  valueOrUpdater:
    | Record<string, GoogleDriveWorkspaceMeta>
    | ((
        current: Record<string, GoogleDriveWorkspaceMeta>
      ) => Record<string, GoogleDriveWorkspaceMeta>)
) {
  const next =
    typeof valueOrUpdater === 'function'
      ? valueOrUpdater(getGoogleDriveWorkspaceMetadata())
      : valueOrUpdater;

  try {
    localStorage.setItem(
      GOOGLE_DRIVE_WORKSPACE_METADATA_LOCAL_STORAGE_KEY,
      JSON.stringify(next)
    );
  } catch (e) {
    logger.error('Failed to set google drive workspace metadata', e);
    throw new Error(
      'Google Drive workspace preferences could not be saved. Free local storage and try again.'
    );
  }
}

export function getGoogleDriveWorkspaceOwner(id: string): string | undefined {
  return getGoogleDriveWorkspaceMetadata()[id]?.accountId;
}

export function isGoogleDriveWorkspaceSyncPaused(id: string): boolean {
  return getGoogleDriveWorkspaceMetadata()[id]?.syncPaused === true;
}

export function setGoogleDriveWorkspaceSyncPaused(
  id: string,
  paused: boolean
): void {
  setGoogleDriveWorkspaceMetadata(current => ({
    ...current,
    [id]: { ...current[id], id, syncPaused: paused },
  }));
  const channel = new BroadcastChannel(
    GOOGLE_DRIVE_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY
  );
  channel.postMessage(id);
  channel.close();
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getGoogleDriveDeviceId(): string {
  try {
    const stored = localStorage.getItem(GOOGLE_DRIVE_DEVICE_ID_KEY);
    if (stored) return stored;

    const id = generateUUID();
    localStorage.setItem(GOOGLE_DRIVE_DEVICE_ID_KEY, id);
    return id;
  } catch {
    return generateUUID();
  }
}

export class GoogleDriveWorkspaceFlavourProvider implements WorkspaceFlavourProvider {
  private readonly googleAuthService: GoogleAuthService;

  constructor(framework: FrameworkProvider) {
    this.googleAuthService = framework.get(GoogleAuthService);
    if (this.googleAuthService.session.userInfo$.value) this.revalidate();
  }

  readonly flavour = 'google-drive';
  private driveConnection = new GoogleDriveConnection();
  private remoteTask: Promise<unknown> = Promise.resolve();
  private driveAccountId: string | undefined;
  private disposed = false;
  private readonly revalidationTimer = setInterval(() => {
    if (this.googleAuthService.session.userInfo$.value) this.revalidate();
  }, 60000);

  dispose(): void {
    this.disposed = true;
    clearInterval(this.revalidationTimer);
    this.driveConnection.setTokenSnapshot(null);
    this.driveConnection.disconnect(true);
    this.notifyChannel.close();
  }

  onSessionChanged(): void {
    if (
      this.googleAuthService.session.userInfo$.value?.sub !==
      this.driveAccountId
    )
      this.driveConnection.setTokenSnapshot(null);
  }

  private readonly notifyChannel = new BroadcastChannel(
    GOOGLE_DRIVE_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY
  );

  private getGoogleTokens(): GoogleDriveWorkerTokens | null {
    const session = this.googleAuthService.session;
    const tokens = session.getTokensSnapshot();
    const accountId = session.userInfo$.value?.sub;
    return tokens && accountId
      ? {
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresAt,
          accountId,
        }
      : null;
  }

  // Local storage types — same platform-conditional pattern as LocalWorkspaceFlavourProvider
  DocStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteDocStorage
      : IndexedDBDocStorage;
  BlobStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteBlobStorage
      : IndexedDBBlobStorage;
  DocSyncStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteDocSyncStorage
      : IndexedDBDocSyncStorage;
  BlobSyncStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteBlobSyncStorage
      : IndexedDBBlobSyncStorage;
  IndexerStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteIndexerStorage
      : IndexedDBIndexerStorage;
  IndexerSyncStorageType = BUILD_CONFIG.isElectron
    ? SqliteIndexerSyncStorage
    : IndexedDBIndexerSyncStorage;

  workspaces$ = LiveData.from(
    new Observable<WorkspaceMetadata[]>(subscriber => {
      let last: WorkspaceMetadata[] | null = null;
      const emit = () => {
        const value = getGoogleDriveWorkspaceIds().map(id => ({
          id,
          flavour: 'google-drive' as const,
        }));
        // Simple reference-equality check to avoid redundant emissions
        const changed =
          last === null ||
          last.length !== value.length ||
          last.some((m, i) => m.id !== value[i].id);
        if (!changed) return;
        subscriber.next(value);
        last = value;
      };

      emit();
      const channel = new BroadcastChannel(
        GOOGLE_DRIVE_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY
      );
      channel.addEventListener('message', emit);

      return () => {
        channel.removeEventListener('message', emit);
        channel.close();
      };
    }),
    []
  );

  isRevalidating$ = new LiveData(false);

  revalidate(): void {
    void this.syncWorkspaceIndexFromDrive().catch(() => undefined);
  }

  private workspaceMetaName(workspaceId: string): string {
    return `ws_${workspaceId}_meta.json`;
  }

  private getWorkspaceName(docCollection: WorkspaceImpl): string | undefined {
    const name = docCollection.doc.getMap('meta').get('name');
    return typeof name === 'string' && name.trim().length > 0
      ? name
      : undefined;
  }

  private workspaceMetaFromDocCollection(
    workspaceId: string,
    docCollection: WorkspaceImpl
  ): GoogleDriveWorkspaceMeta {
    const now = new Date().toISOString();
    return {
      id: workspaceId,
      accountId: this.googleAuthService.session.userInfo$.value?.sub,
      name: this.getWorkspaceName(docCollection),
      createdAt: now,
      updatedAt: now,
    };
  }

  private async withDriveConnection<T>(
    task: () => Promise<T>,
    expectedAccountId?: string
  ): Promise<T> {
    const execute = async () => {
      if (this.disposed)
        throw new Error('Drive workspace provider is disposed.');
      const session = this.googleAuthService.session;
      const accountId = session.userInfo$.value?.sub;
      if (!accountId) throw new Error('Connect Google Drive first.');
      if (expectedAccountId && accountId !== expectedAccountId)
        throw new Error('Google account changed. Original workspace retained.');
      await session.getAccessToken();
      if (this.disposed)
        throw new Error('Drive workspace provider is disposed.');
      const tokens = this.getGoogleTokens();
      if (!tokens || tokens.accountId !== accountId)
        throw new Error('Google account changed. Try again.');
      const connection = new GoogleDriveConnection({ accountId, tokens });
      this.driveConnection = connection;
      this.driveAccountId = accountId;
      connection.connect();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        await connection.waitForConnected(controller.signal);
        const result = await task();
        if (session.userInfo$.value?.sub !== accountId)
          throw new Error('Google account changed. Try again.');
        return result;
      } finally {
        clearTimeout(timer);
        connection.setTokenSnapshot(null);
        connection.disconnect(true);
      }
    };
    const next = this.remoteTask.then(execute, execute);
    this.remoteTask = next.catch(() => undefined);
    return next;
  }

  private async upsertWorkspaceMeta(meta: GoogleDriveWorkspaceMeta) {
    if (
      !meta.accountId ||
      meta.accountId !== this.driveAccountId ||
      this.googleAuthService.session.userInfo$.value?.sub !== meta.accountId
    )
      throw new Error(
        'Google workspace owner changed. Metadata was not uploaded.'
      );
    const name = this.workspaceMetaName(meta.id);
    const content = new TextEncoder().encode(JSON.stringify(meta));
    const existing = await this.driveConnection.searchFiles(
      `name = '${driveQueryValue(name)}' and trashed = false`
    );

    if (existing.length > 0) {
      await this.driveConnection.updateFile(
        existing[0].id,
        content,
        'application/json'
      );
      return;
    }

    await this.driveConnection.createFile(name, content, 'application/json');
  }

  private async listRemoteWorkspaceMetas(): Promise<
    GoogleDriveWorkspaceMeta[]
  > {
    const files = await this.driveConnection.searchFiles(
      `name contains '_meta.json' and trashed = false`
    );

    const metas: GoogleDriveWorkspaceMeta[] = [];

    for (const file of files) {
      const match = /^ws_(.+)_meta\.json$/.exec(file.name);
      if (!match) {
        continue;
      }

      const workspaceId = match[1];
      try {
        const content = await this.driveConnection.downloadFile(file.id);
        const parsed = JSON.parse(
          new TextDecoder().decode(content)
        ) as Partial<GoogleDriveWorkspaceMeta>;
        const modifiedAt = file.modifiedTime ?? new Date().toISOString();
        metas.push({
          id: workspaceId,
          accountId: this.googleAuthService.session.userInfo$.value?.sub,
          name: parsed.name,
          avatar: parsed.avatar,
          createdAt: parsed.createdAt ?? modifiedAt,
          updatedAt: parsed.updatedAt ?? modifiedAt,
        });
      } catch (error) {
        logger.error(
          `Failed to parse Google Drive workspace meta ${file.name}`,
          error
        );
      }
    }

    return metas;
  }

  private async syncWorkspaceIndexFromDrive() {
    if (
      this.disposed ||
      this.isRevalidating$.value ||
      !this.googleAuthService.session.userInfo$.value
    )
      return;
    this.isRevalidating$.next(true);
    try {
      const remoteMetas = await this.withDriveConnection(async () => {
        const remote = await this.listRemoteWorkspaceMetas();
        const accountId = this.googleAuthService.session.userInfo$.value?.sub;
        // Initial metadata uploads may be interrupted. Retry only explicitly owned caches.
        for (const meta of Object.values(getGoogleDriveWorkspaceMetadata())) {
          if (
            meta.accountId === accountId &&
            !meta.hidden &&
            !meta.syncPaused &&
            !remote.some(item => item.id === meta.id)
          ) {
            await this.upsertWorkspaceMeta(meta);
          }
        }
        return remote;
      });

      const accountId = this.googleAuthService.session.userInfo$.value?.sub;
      const accepted = remoteMetas.filter(
        meta =>
          !getGoogleDriveWorkspaceMetadata()[meta.id]?.hidden &&
          meta.accountId === accountId &&
          (!getGoogleDriveWorkspaceOwner(meta.id) ||
            getGoogleDriveWorkspaceOwner(meta.id) === accountId)
      );
      setGoogleDriveWorkspaceIds(ids => [
        ...ids,
        ...accepted.map(meta => meta.id),
      ]);
      setGoogleDriveWorkspaceMetadata(current => ({
        ...current,
        ...Object.fromEntries(
          accepted.map(meta => [
            meta.id,
            { ...meta, syncPaused: current[meta.id]?.syncPaused },
          ])
        ),
      }));
    } catch (error) {
      logger.error('Failed to sync Google Drive workspace index', error);
    } finally {
      this.isRevalidating$.next(false);
      if (!this.disposed) this.notifyChannel.postMessage(null);
    }
  }

  async createWorkspace(
    initial: (
      docCollection: WorkspaceImpl,
      blobStorage: BlobStorage,
      docStorage: DocStorage
    ) => Promise<void>
  ): Promise<WorkspaceMetadata> {
    const accountId = this.googleAuthService.session.userInfo$.value?.sub;
    if (!accountId || !(await this.googleAuthService.session.getAccessToken()))
      throw new Error(
        'Connect Google Drive before creating a synced workspace.'
      );
    const id = nanoid();

    // Initialise local storage for the new workspace
    const docStorage = new this.DocStorageType({
      id,
      flavour: this.flavour,
      type: 'workspace',
    });
    docStorage.connection.connect();
    await docStorage.connection.waitForConnected();

    const blobStorage = new this.BlobStorageType({
      id,
      flavour: this.flavour,
      type: 'workspace',
    });
    blobStorage.connection.connect();
    await blobStorage.connection.waitForConnected();

    const docList = new Set<YDoc>();

    const docCollection = new WorkspaceImpl({
      id,
      rootDoc: new YDoc({ guid: id }),
      blobSource: {
        get: async key => {
          const record = await blobStorage.get(key);
          return record
            ? new Blob([toArrayBuffer(record.data)], { type: record.mime })
            : null;
        },
        delete: async () => {
          return;
        },
        list: async () => {
          return [];
        },
        set: async (blobId, blob) => {
          await blobStorage.set({
            key: blobId,
            data: new Uint8Array(await blob.arrayBuffer()),
            mime: blob.type,
          });
          return blobId;
        },
        name: 'blob',
        readonly: false,
      },
      onLoadDoc(doc) {
        docList.add(doc);
      },
    });

    try {
      await initial(docCollection, blobStorage, docStorage);

      if (this.googleAuthService.session.userInfo$.value?.sub !== accountId)
        throw new Error(
          'Google account changed while copying. Original workspace retained.'
        );
      const workspaceMeta = {
        ...this.workspaceMetaFromDocCollection(id, docCollection),
        accountId,
      };
      docList.add(docCollection.doc);

      for (const subdoc of docList) {
        await docStorage.pushDocUpdate({
          docId: subdoc.guid,
          bin: encodeStateAsUpdate(subdoc),
        });
      }

      docStorage.connection.disconnect();
      blobStorage.connection.disconnect();

      if (this.googleAuthService.session.userInfo$.value?.sub !== accountId)
        throw new Error(
          'Google account changed while copying. Original workspace retained.'
        );
      // Persist workspace id locally
      setGoogleDriveWorkspaceIds(ids => [...ids, id]);
      setGoogleDriveWorkspaceMetadata(current => ({
        ...current,
        [id]: workspaceMeta,
      }));

      try {
        await this.withDriveConnection(async () => {
          await this.upsertWorkspaceMeta(workspaceMeta);
        }, accountId);
      } catch (error) {
        logger.error(
          `Failed to write Google Drive workspace meta for ${id}`,
          error
        );
      }

      this.notifyChannel.postMessage(id);
    } finally {
      docStorage.connection.disconnect();
      blobStorage.connection.disconnect();
      docCollection.dispose();
    }

    return { id, flavour: 'google-drive' };
  }

  async deleteWorkspace(id: string): Promise<void> {
    setGoogleDriveWorkspaceIds(ids => ids.filter(x => x !== id));
    setGoogleDriveWorkspaceMetadata(current => ({
      ...current,
      [id]: { ...current[id], id, hidden: true },
    }));
    this.notifyChannel.postMessage(id);

    // Removing the cached workspace never deletes the user's Drive files.
  }

  async getWorkspaceProfile(
    id: string
  ): Promise<WorkspaceProfileInfo | undefined> {
    const docStorage = new this.DocStorageType({
      id,
      flavour: this.flavour,
      type: 'workspace',
      readonlyMode: true,
    });
    docStorage.connection.connect();
    await docStorage.connection.waitForConnected();
    const localData = await docStorage.getDoc(id);
    docStorage.connection.disconnect();

    if (!localData) {
      const cachedMeta = getGoogleDriveWorkspaceMetadata()[id];
      return {
        name: cachedMeta?.name,
        avatar: cachedMeta?.avatar,
        isOwner: true,
      };
    }

    const client = getWorkspaceProfileWorker();
    const result = await client.call(
      'renderWorkspaceProfile',
      [localData.bin].filter(Boolean) as Uint8Array[]
    );

    return {
      name: result.name,
      avatar: result.avatar,
      isOwner: true,
    };
  }

  async getWorkspaceBlob(id: string, blobKey: string): Promise<Blob | null> {
    const storage = new this.BlobStorageType({
      id,
      flavour: this.flavour,
      type: 'workspace',
    });
    storage.connection.connect();
    await storage.connection.waitForConnected();
    const blob = await storage.get(blobKey);
    storage.connection.disconnect();
    return blob
      ? new Blob([toArrayBuffer(blob.data)], { type: blob.mime })
      : null;
  }

  async listBlobs(id: string): Promise<ListedBlobRecord[]> {
    const storage = new this.BlobStorageType({
      id,
      flavour: this.flavour,
      type: 'workspace',
    });
    storage.connection.connect();
    await storage.connection.waitForConnected();
    return storage.list();
  }

  async deleteBlob(
    id: string,
    blob: string,
    permanent: boolean
  ): Promise<void> {
    const storage = new this.BlobStorageType({
      id,
      flavour: this.flavour,
      type: 'workspace',
    });
    storage.connection.connect();
    await storage.connection.waitForConnected();
    await storage.delete(blob, permanent);
  }

  getEngineWorkerInitOptions(workspaceId: string): WorkerInitOptions {
    const accountId = getGoogleDriveWorkspaceOwner(workspaceId);
    const tokens = this.getGoogleTokens();
    const allowedTokens =
      accountId &&
      tokens?.accountId === accountId &&
      !isGoogleDriveWorkspaceSyncPaused(workspaceId)
        ? tokens
        : null;
    return {
      local: {
        doc: {
          name: this.DocStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        blob: {
          name: this.BlobStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        docSync: {
          name: this.DocSyncStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        blobSync: {
          name: this.BlobSyncStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        awareness: {
          name: 'BroadcastChannelAwarenessStorage',
          opts: {
            id: `${this.flavour}:${workspaceId}`,
          },
        },
        indexer: {
          name: this.IndexerStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        indexerSync: {
          name: this.IndexerSyncStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
      },
      remotes: {
        'google-drive': {
          doc: {
            name: 'google-drive:doc',
            opts: {
              id: workspaceId,
              flavour: this.flavour,
              type: 'workspace',
              deviceId: getGoogleDriveDeviceId(),
              accountId,
              tokens: allowedTokens,
            },
          },
          blob: {
            name: 'google-drive:blob',
            opts: {
              id: workspaceId,
              accountId,
              tokens: allowedTokens,
            },
          },
        },
      },
    };
  }
}

/** Cached workspaces remain visible and writable without an authenticated account. */
export class GoogleDriveWorkspaceFlavoursProvider
  extends Service
  implements WorkspaceFlavoursProvider
{
  private readonly provider = new GoogleDriveWorkspaceFlavourProvider(
    this.framework
  );
  workspaceFlavours$ = new LiveData<WorkspaceFlavourProvider[]>([
    this.provider,
  ]);
  private readonly authSubscription = this.framework
    .get(GoogleAuthService)
    .session.userInfo$.subscribe(user => {
      this.provider.onSessionChanged();
      if (user) this.provider.revalidate();
    });
  override dispose(): void {
    this.authSubscription.unsubscribe();
    this.provider.dispose();
    super.dispose();
  }
}
