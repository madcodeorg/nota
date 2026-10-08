import { Transformer } from '@blocksuite/affine/store';
import { snapshotBlobIds } from '@blocksuite/affine/widgets/linked-doc';
import { Service } from '@nota/infra';
import type { BlobRecord, DocRecord } from '@nota/nbstore';
import { applyUpdate, Doc } from 'yjs';

import { transformWorkspaceDBLocalToCloud } from '../../db/utils';
import type { Workspace } from '../entities/workspace';
import { getAFFiNEWorkspaceSchema } from '../global-schema';
import { WorkspaceImpl } from '../impls/workspace';
import type { WorkspaceMetadata } from '../metadata';
import type { WorkspaceDestroyService } from './destroy';
import type { WorkspaceFactoryService } from './factory';

/** Use the same media contract as native exports, including database/canvas files. */
export function workspaceCopyBlobIds(
  rootId: string,
  records: DocRecord[]
): Set<string> {
  const root = records.find(record => record.docId === rootId);
  if (!root)
    throw new Error(
      'Workspace root is unavailable. Original workspace retained.'
    );
  const rootDoc = new Doc({ guid: rootId });
  const collection = new WorkspaceImpl({ id: rootId, rootDoc });
  applyUpdate(rootDoc, root.bin);
  try {
    const transformer = new Transformer({
      schema: getAFFiNEWorkspaceSchema(),
      blobCRUD: collection.blobSync,
      docCRUD: {
        create: () => {
          throw new Error('Read-only copy validation');
        },
        get: () => null,
        delete: () => {},
      },
    });
    const ids = new Set<string>();
    for (const record of records) {
      if (record.docId === rootId) continue;
      const doc = collection.getDoc(record.docId);
      if (!doc) continue; // Workspace settings/database backing docs have no page schema.
      doc.load();
      applyUpdate(doc.spaceDoc, record.bin);
      const snapshot = transformer.docToSnapshot(doc.getStore());
      if (!snapshot)
        throw new Error(
          `Page ${record.docId} could not be inspected. Original workspace retained.`
        );
      for (const id of snapshotBlobIds(snapshot)) ids.add(id);
    }
    return ids;
  } finally {
    collection.dispose();
    rootDoc.destroy();
  }
}

export class WorkspaceTransformService extends Service {
  constructor(
    private readonly factory: WorkspaceFactoryService,
    private readonly destroy: WorkspaceDestroyService
  ) {
    super();
  }

  /** Capture a durable, coherent point; changes during copying leave the source intact. */
  private readonly captureLocalContent = async (workspace: Workspace) => {
    await workspace.engine.doc.waitForUpdated();
    const storage = workspace.engine.doc.storage;
    const before = await storage.getDocTimestamps();
    const ids = new Set([
      workspace.docCollection.doc.guid,
      ...workspace.docCollection.docs.keys(),
      ...Object.keys(before),
    ]);
    const docs: DocRecord[] = [];
    for (const id of ids) {
      const record = await storage.getDoc(id);
      if (!record)
        throw new Error(
          `Page ${id} is unavailable. Original workspace retained.`
        );
      docs.push(record);
    }
    const blobs: BlobRecord[] = [];
    const listedBefore = await workspace.engine.blob.storage.list();
    const required = workspaceCopyBlobIds(
      workspace.docCollection.doc.guid,
      docs
    );
    for (const item of listedBefore) required.add(item.key);
    for (const key of required) {
      const record =
        workspace.flavour === 'google-drive'
          ? await workspace.engine.blob.storage.get(key)
          : await workspace.engine.blob.get(key);
      if (!record)
        throw new Error(
          `Attachment ${key} is unavailable. Original workspace retained.`
        );
      blobs.push(record);
    }
    const listed = await workspace.engine.blob.storage.list();
    const assertUnchanged = async () => {
      await workspace.engine.doc.waitForUpdated();
      const after = await storage.getDocTimestamps();
      const afterBlobs = await workspace.engine.blob.storage.list();
      const clocks = (value: Record<string, Date>) =>
        JSON.stringify(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, date]) => [id, date.getTime()])
        );
      const inventory = (value: typeof listed) =>
        JSON.stringify(
          value
            .map(item => [item.key, item.size, item.mime])
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
        );
      for (const blob of blobs) {
        const current = await workspace.engine.blob.storage.get(blob.key);
        if (
          !current ||
          current.mime !== blob.mime ||
          current.data.length !== blob.data.length ||
          current.data.some((byte, i) => byte !== blob.data[i])
        ) {
          throw new Error(
            'Attachment changed while copying. Retry after editing. Original workspace retained.'
          );
        }
      }
      if (
        clocks(before) !== clocks(after) ||
        inventory(listed) !== inventory(afterBlobs)
      ) {
        throw new Error(
          'Workspace changed while copying. Finish editing and retry. Original workspace retained.'
        );
      }
    };
    await assertUnchanged();
    return { docs, blobs, assertUnchanged };
  };

  private readonly copyUserOwnedWorkspace = async (
    source: Workspace,
    flavour: 'local' | 'google-drive'
  ): Promise<WorkspaceMetadata> => {
    const captured = await this.captureLocalContent(source);
    return this.factory.create(
      flavour,
      async (collection, blobStorage, docStorage) => {
        const rootId = source.docCollection.doc.guid;
        for (const record of captured.docs) {
          const docId =
            record.docId === rootId ? collection.doc.guid : record.docId;
          if (record.docId === rootId) applyUpdate(collection.doc, record.bin);
          else {
            const doc = collection.getDoc(record.docId);
            if (doc) {
              doc.load();
              applyUpdate(doc.spaceDoc, record.bin);
            }
          }
          await docStorage.pushDocUpdate({ ...record, docId });
          const saved = await docStorage.getDoc(docId);
          if (
            !saved ||
            saved.bin.length !== record.bin.length ||
            saved.bin.some((byte, i) => byte !== record.bin[i])
          ) {
            throw new Error(
              `Page ${record.docId} did not copy completely. Original workspace retained.`
            );
          }
        }
        for (const record of captured.blobs) {
          await blobStorage.set(record);
          const saved = await blobStorage.get(record.key);
          if (
            !saved ||
            saved.mime !== record.mime ||
            saved.data.length !== record.data.length ||
            saved.data.some((byte, i) => byte !== record.data[i])
          ) {
            throw new Error(
              `Attachment ${record.key} did not copy completely. Original workspace retained.`
            );
          }
        }
        await captured.assertUnchanged();
      }
    );
  };

  transformDriveToLocal = async (
    workspace: Workspace
  ): Promise<WorkspaceMetadata> => {
    if (workspace.flavour !== 'google-drive')
      throw new Error('Only Drive workspaces can be kept as a local copy.');
    return this.copyUserOwnedWorkspace(workspace, 'local');
  };

  /**
   * helper function to transform local workspace to cloud workspace
   *
   * @param targetUserId - cloud account id for server-backed workspaces; ignored for google-drive
   */
  transformLocalToCloud = async (
    local: Workspace,
    targetUserId: string | null,
    flavour: string
  ): Promise<WorkspaceMetadata> => {
    if (local.flavour !== 'local') {
      throw new Error(
        'Only local workspace can be transformed to cloud workspace'
      );
    }

    if (flavour === 'google-drive')
      return this.copyUserOwnedWorkspace(local, 'google-drive');

    await local.engine.doc.waitForUpdated();
    const localDocStorage = local.engine.doc.storage;
    const localDocList = Array.from(local.docCollection.docs.keys());

    const newMetadata = await this.factory.create(
      flavour,
      async (docCollection, blobStorage, docStorage) => {
        const rootDocBinary = (
          await localDocStorage.getDoc(local.docCollection.doc.guid)
        )?.bin;

        if (rootDocBinary) {
          applyUpdate(docCollection.doc, rootDocBinary);
        }

        for (const subdocId of localDocList) {
          const subdocBinary = (await localDocStorage.getDoc(subdocId))?.bin;
          if (subdocBinary) {
            const doc = docCollection.getDoc(subdocId);
            if (doc) {
              const spaceDoc = doc.spaceDoc;
              doc.load();
              applyUpdate(spaceDoc, subdocBinary);
            }
          }
        }

        // transform db
        const userdataOwnerId =
          flavour === 'google-drive' ? '__local__' : targetUserId;
        if (!userdataOwnerId) {
          throw new Error('Missing user id for cloud workspace conversion');
        }
        await transformWorkspaceDBLocalToCloud(
          local.id,
          docCollection.id,
          localDocStorage,
          docStorage,
          userdataOwnerId
        );

        const blobList = await local.engine.blob.storage.list();

        for (const { key } of blobList) {
          const blob = await local.engine.blob.storage.get(key);
          if (blob) {
            await blobStorage.set(blob);
          }
        }
      }
    );

    await this.destroy.deleteWorkspace(local.meta);

    return newMetadata;
  };
}
