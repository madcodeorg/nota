import { toArrayBuffer } from '@nota/core/utils/array-buffer';
import { DebugLogger } from '@nota/debug';
import type { FrameworkProvider } from '@nota/infra';
import { LiveData, Service } from '@nota/infra';
import {
  type BlobStorage,
  type DocStorage,
  type ListedBlobRecord,
} from '@nota/nbstore';
import { getOrCreateGoogleDriveConnection } from '@nota/nbstore/google-drive';
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

import { GoogleAuthService, type GoogleTokens } from '../../google-auth';
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

type GoogleDriveWorkerTokens = GoogleTokens;

type GoogleDriveWorkspaceMeta = {
  id: string;
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
  }
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

class GoogleDriveWorkspaceFlavourProvider implements WorkspaceFlavourProvider {
  private readonly googleAuthService: GoogleAuthService;

  constructor(framework: FrameworkProvider) {
    this.googleAuthService = framework.get(GoogleAuthService);
    void this.syncWorkspaceIndexFromDrive().catch(() => undefined);
  }

  readonly flavour = 'google-drive';
  private readonly driveConnection = getOrCreateGoogleDriveConnection();

  private readonly notifyChannel = new BroadcastChannel(
    GOOGLE_DRIVE_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY
  );

  private getGoogleTokens(): GoogleDriveWorkerTokens | null {
    return this.googleAuthService.session.getTokensSnapshot();
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

  private workspaceFilePrefix(workspaceId: string): string {
    return `ws_${workspaceId}_`;
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
      name: this.getWorkspaceName(docCollection),
      createdAt: now,
      updatedAt: now,
    };
  }

  private async withDriveConnection<T>(task: () => Promise<T>): Promise<T> {
    (
      this.driveConnection as {
        setTokenSnapshot?: (tokens?: GoogleDriveWorkerTokens | null) => void;
      }
    ).setTokenSnapshot?.(this.getGoogleTokens());
    this.driveConnection.connect();
    await this.driveConnection.waitForConnected();
    try {
      return await task();
    } finally {
      this.driveConnection.disconnect();
    }
  }

  private async upsertWorkspaceMeta(meta: GoogleDriveWorkspaceMeta) {
    const name = this.workspaceMetaName(meta.id);
    const content = new TextEncoder().encode(JSON.stringify(meta));
    const existing = await this.driveConnection.searchFiles(
      `name = '${name}' and trashed = false`
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
          id: parsed.id ?? workspaceId,
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
    this.isRevalidating$.next(true);
    try {
      const remoteMetas = await this.withDriveConnection(async () => {
        return await this.listRemoteWorkspaceMetas();
      });

      setGoogleDriveWorkspaceIds(ids => [
        ...ids,
        ...remoteMetas.map(meta => meta.id),
      ]);
      setGoogleDriveWorkspaceMetadata(current => ({
        ...current,
        ...Object.fromEntries(remoteMetas.map(meta => [meta.id, meta])),
      }));
    } catch (error) {
      logger.error('Failed to sync Google Drive workspace index', error);
    } finally {
      this.isRevalidating$.next(false);
      this.notifyChannel.postMessage(null);
    }
  }

  async createWorkspace(
    initial: (
      docCollection: WorkspaceImpl,
      blobStorage: BlobStorage,
      docStorage: DocStorage
    ) => Promise<void>
  ): Promise<WorkspaceMetadata> {
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

      const workspaceMeta = this.workspaceMetaFromDocCollection(
        id,
        docCollection
      );

      for (const subdoc of docList) {
        await docStorage.pushDocUpdate({
          docId: subdoc.guid,
          bin: encodeStateAsUpdate(subdoc),
        });
      }

      docStorage.connection.disconnect();
      blobStorage.connection.disconnect();

      // Persist workspace id locally
      setGoogleDriveWorkspaceIds(ids => [...ids, id]);
      setGoogleDriveWorkspaceMetadata(current => ({
        ...current,
        [id]: workspaceMeta,
      }));

      try {
        await this.withDriveConnection(async () => {
          await this.upsertWorkspaceMeta(workspaceMeta);
        });
      } catch (error) {
        logger.error(
          `Failed to write Google Drive workspace meta for ${id}`,
          error
        );
      }

      this.notifyChannel.postMessage(id);
    } finally {
      docCollection.dispose();
    }

    return { id, flavour: 'google-drive' };
  }

  async deleteWorkspace(id: string): Promise<void> {
    setGoogleDriveWorkspaceIds(ids => ids.filter(x => x !== id));
    setGoogleDriveWorkspaceMetadata(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    this.notifyChannel.postMessage(id);

    try {
      await this.withDriveConnection(async () => {
        const files = await this.driveConnection.searchFiles(
          `name contains '${this.workspaceFilePrefix(id)}' and trashed = false`
        );
        await Promise.all(
          files.map((file: { id: string }) =>
            this.driveConnection.deleteFile(file.id)
          )
        );
      });
    } catch (error) {
      logger.error(`Failed to delete Google Drive workspace ${id}`, error);
    }
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
              tokens: this.getGoogleTokens(),
            } as any,
          },
          blob: {
            name: 'google-drive:blob',
            opts: {
              id: workspaceId,
              tokens: this.getGoogleTokens(),
            } as any,
          },
        },
      },
    };
  }
}

/**
 * Provides Google Drive–backed workspaces.
 *
 * The provider is only active when the user has connected their Google account
 * (GoogleAuthService.session.status$ === 'connected'). While disconnected the
 * flavour list is empty so no Google Drive workspaces are surfaced.
 */
export class GoogleDriveWorkspaceFlavoursProvider
  extends Service
  implements WorkspaceFlavoursProvider
{
  private readonly googleAuthService = this.framework.get(GoogleAuthService);

  workspaceFlavours$ = LiveData.from<WorkspaceFlavourProvider[]>(
    this.googleAuthService.session.status$.map(status =>
      status === 'connected'
        ? [new GoogleDriveWorkspaceFlavourProvider(this.framework)]
        : []
    ),
    []
  );
}
