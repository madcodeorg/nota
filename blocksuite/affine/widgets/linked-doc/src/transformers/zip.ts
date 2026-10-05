import type { ColumnDataType, SerializedCells } from '@blocksuite/affine-model';
import {
  replaceIdMiddleware,
  titleMiddleware,
} from '@blocksuite/affine-shared/adapters';
import { sha } from '@blocksuite/global/utils';
import type {
  BlockSnapshot,
  DocSnapshot,
  Schema,
  Store,
  Workspace,
} from '@blocksuite/store';
import {
  DocSnapshotSchema,
  extMimeMap,
  getAssetName,
  Transformer,
} from '@blocksuite/store';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import { z } from 'zod';

import { download, Unzip, Zip } from './utils.js';

const MANIFEST_PATH = 'nota.snapshot-manifest.json';
const ManifestSchema = z.object({
  format: z.literal('nota-workspace-snapshot'),
  version: z.literal(1),
  documents: z.array(z.object({ id: z.string(), path: z.string() })),
  assets: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      size: z.number().int().nonnegative(),
      mime: z.string(),
      sha256: z.string(),
      name: z.string().optional(),
    })
  ),
  blockVersions: z.record(z.number()),
});
type Manifest = z.infer<typeof ManifestSchema>;

function walkBlock(
  block: BlockSnapshot,
  visit: (block: BlockSnapshot, parentFlavour?: string) => void,
  parentFlavour?: string
) {
  visit(block, parentFlavour);
  block.children.forEach(child => walkBlock(child, visit, block.flavour));
}

function snapshotBlobIds(snapshot: DocSnapshot) {
  const ids = new Set<string>();
  walkBlock(snapshot.blocks, block => {
    if (
      ['affine:image', 'affine:attachment'].includes(block.flavour) &&
      typeof block.props.sourceId === 'string' &&
      block.props.sourceId
    )
      ids.add(block.props.sourceId);
    if (block.flavour === 'affine:surface')
      Object.values(
        (block.props.elements ?? {}) as Record<string, Record<string, unknown>>
      ).forEach(element => {
        if (
          element.type === 'image' &&
          typeof element.sourceId === 'string' &&
          element.sourceId
        )
          ids.add(element.sourceId);
      });
    if (block.flavour !== 'affine:database') return;
    const columns = block.props.columns as ColumnDataType[];
    const cells = block.props.cells as SerializedCells;
    columns
      .filter(column => column.type === 'attachment')
      .forEach(column => {
        Object.values(cells).forEach(row => {
          const value = row[column.id]?.value;
          if (!value || typeof value !== 'object') return;
          Object.entries(value).forEach(([id, file]) =>
            ids.add(
              file &&
                typeof file === 'object' &&
                'id' in file &&
                typeof file.id === 'string'
                ? file.id
                : id
            )
          );
        });
      });
  });
  return ids;
}

async function exportDocs(
  collection: Workspace,
  schema: Schema,
  docs: Store[]
) {
  const zip = new Zip();
  const job = new Transformer({
    schema,
    blobCRUD: collection.blobSync,
    docCRUD: {
      create: (id: string) => collection.createDoc(id).getStore({ id }),
      get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
      delete: (id: string) => collection.removeDoc(id),
    },
    middlewares: [
      replaceIdMiddleware(collection.idGenerator),
      titleMiddleware(collection.meta.docMetas),
    ],
  });

  const snapshots = docs.map(job.docToSnapshot);
  if (snapshots.some(snapshot => !snapshot))
    throw new Error('Snapshot export could not serialize every selected page.');
  const requiredBlobIds = new Set<string>();
  const manifest: Manifest = {
    format: 'nota-workspace-snapshot',
    version: 1,
    documents: [],
    assets: [],
    blockVersions: schema.versions,
  };
  await Promise.all(
    snapshots
      .filter((snapshot): snapshot is DocSnapshot => !!snapshot)
      .map(async snapshot => {
        for (const id of snapshotBlobIds(snapshot)) requiredBlobIds.add(id);
        // Use the title and id as the snapshot file name
        const title = (snapshot.meta.title || 'untitled').replace(
          /[\\/]/g,
          '_'
        );
        const id = snapshot.meta.id;
        const snapshotName = `${title}-${id}.snapshot.json`;
        manifest.documents.push({ id, path: snapshotName });
        await zip.file(snapshotName, JSON.stringify(snapshot, null, 2));
      })
  );

  const assets = zip.folder('assets');
  const pathBlobIdMap = job.assetsManager.getPathBlobIdMap();
  for (const blobId of pathBlobIdMap.values()) requiredBlobIds.add(blobId);
  const assetsMap = job.assets;

  // Required blobs must be complete before we download a recovery snapshot.
  const results = await Promise.all(
    Array.from(requiredBlobIds).map(async blobId => {
      try {
        await job.assetsManager.readFromBlob(blobId);
        const ext = getAssetName(assetsMap, blobId).split('.').at(-1);
        const blob = assetsMap.get(blobId);
        if (blob) {
          const path = `assets/${blobId}.${ext}`;
          await assets.file(`${blobId}.${ext}`, blob);
          manifest.assets.push({
            id: blobId,
            path,
            size: blob.size,
            mime: blob.type,
            sha256: await sha(await blob.arrayBuffer()),
            ...(blob instanceof File ? { name: blob.name } : {}),
          });
          return { success: true, blobId };
        }
        return { success: false, blobId, error: 'Blob not found' };
      } catch (error) {
        console.error(`Failed to process blob: ${blobId}`, error);
        return { success: false, blobId, error };
      }
    })
  );

  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    throw new Error(
      `Snapshot export could not include ${failures.length} required attachment(s). Make the files available locally and retry.`
    );
  }

  await zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  const downloadBlob = await zip.generate();
  // Use the collection id as the zip file name
  return download(downloadBlob, `${collection.id}.bs.zip`);
}

async function importDocs(
  collection: Workspace,
  schema: Schema,
  imported: Blob,
  signal?: AbortSignal
): Promise<Store[]> {
  signal?.throwIfAborted();
  const unzip = new Unzip();
  await unzip.load(imported);
  const entries = new Map<string, Blob>();
  for (const { path, content } of unzip) {
    if (!path.includes('MACOSX') && !path.includes('DS_Store'))
      entries.set(path, content);
  }
  let manifest: Manifest | undefined;
  const manifestBlob = entries.get(MANIFEST_PATH);
  if (manifestBlob) {
    const result = ManifestSchema.safeParse(
      JSON.parse(await manifestBlob.text())
    );
    if (!result.success)
      throw new Error(
        'This snapshot manifest is invalid or uses an unsupported version.'
      );
    manifest = result.data;
  }
  const documentEntries =
    manifest?.documents ??
    [...entries.keys()]
      .filter(path => path.endsWith('.snapshot.json'))
      .map(path => ({ id: '', path }));
  if (!documentEntries.length)
    throw new Error('No Nota snapshots were found in the archive.');
  const snapshots: DocSnapshot[] = [];
  const originalDocIds = new Set<string>();
  const ids = new Map<string, string>();
  for (const entry of documentEntries) {
    signal?.throwIfAborted();
    const blob = entries.get(entry.path);
    if (!blob)
      throw new Error('A document listed in the snapshot manifest is missing.');
    const snapshot = JSON.parse(await blob.text()) as DocSnapshot;
    DocSnapshotSchema.parse(snapshot);
    if (entry.id && entry.id !== snapshot.meta.id)
      throw new Error(
        'Snapshot document identities do not match the manifest.'
      );
    if (originalDocIds.has(snapshot.meta.id))
      throw new Error('The archive repeats a document identity.');
    originalDocIds.add(snapshot.meta.id);
    ids.set(snapshot.meta.id, collection.idGenerator());
    const blockIds = new Set<string>();
    walkBlock(snapshot.blocks, (block, parentFlavour) => {
      if (blockIds.has(block.id))
        throw new Error('The snapshot repeats a block identity.');
      blockIds.add(block.id);
      schema.validate(
        block.flavour,
        parentFlavour,
        block.children.map(child => child.flavour)
      );
      if (!ids.has(block.id)) ids.set(block.id, collection.idGenerator());
      if (block.flavour === 'affine:database') {
        const columns = block.props.columns as ColumnDataType[];
        if (
          !Array.isArray(columns) ||
          !block.props.cells ||
          typeof block.props.cells !== 'object' ||
          !Array.isArray(block.props.views)
        )
          throw new Error('A database snapshot has invalid properties.');
        columns.forEach(column => {
          if (!ids.has(column.id)) ids.set(column.id, collection.idGenerator());
        });
      }
    });
    snapshots.push(snapshot);
  }
  const assets = new Map<string, Blob>();
  const assetEntries =
    manifest?.assets ??
    [...entries.keys()]
      .filter(path => path.startsWith('assets/') && !path.endsWith('/'))
      .map(path => ({
        id: path.slice(7).replace(/\.[^/.]+$/, ''),
        path,
        size: -1,
        mime: extMimeMap.get(path.split('.').at(-1) ?? '') ?? '',
        sha256: '',
        name: path.slice(7),
      }));
  for (const entry of assetEntries) {
    signal?.throwIfAborted();
    const blob = entries.get(entry.path);
    if (!blob || (entry.size >= 0 && entry.size !== blob.size))
      throw new Error(
        'A required snapshot attachment is missing or incomplete.'
      );
    if (entry.sha256 && (await sha(await blob.arrayBuffer())) !== entry.sha256)
      throw new Error('A snapshot attachment failed its integrity check.');
    if (assets.has(entry.id))
      throw new Error('The snapshot repeats an attachment identity.');
    assets.set(
      entry.id,
      new File([blob], entry.name || entry.id, { type: entry.mime })
    );
  }
  // Older archives sometimes store sourceId with a leading slash.
  for (const snapshot of snapshots) {
    walkBlock(snapshot.blocks, block => {
      const sourceId = block.props.sourceId;
      if (
        typeof sourceId === 'string' &&
        sourceId.startsWith('/') &&
        assets.has(sourceId.slice(1))
      )
        block.props.sourceId = sourceId.slice(1);
    });
    for (const id of snapshotBlobIds(snapshot)) {
      if (!assets.has(id))
        throw new Error(
          'The snapshot is missing a required attachment. No pages were imported.'
        );
    }
  }
  const staging = collection.createStagingWorkspace?.();
  if (!staging)
    throw new Error('This workspace cannot stage a snapshot import safely.');
  const job = new Transformer({
    schema,
    blobCRUD: staging.blobSync,
    docCRUD: {
      create: id => staging.createDoc(id).getStore({ id }),
      get: id =>
        staging.getDoc(id)?.getStore({ id }) ??
        (!ids.has(id)
          ? (collection.getDoc(id)?.getStore({ id }) ?? null)
          : null),
      delete: id => staging.removeDoc(id),
    },
    middlewares: [
      replaceIdMiddleware(collection.idGenerator, ids),
      titleMiddleware(staging.meta.docMetas),
    ],
  });
  try {
    for (const [id, blob] of assets) job.assets.set(id, blob);
    await Promise.all(
      [...assets.keys()].map(id => job.assetsManager.writeToBlob(id))
    );
    const stagedIds: string[] = [];
    for (const snapshot of snapshots) {
      signal?.throwIfAborted();
      const store = await job.snapshotToDoc(snapshot);
      if (!store || !store.root)
        throw new Error(
          'A snapshot could not be restored. No pages were imported.'
        );
      // Transformer adapters can return undefined on failure; never publish a
      // partial tree even when an adapter swallowed its conversion exception.
      walkBlock(snapshot.blocks, block => {
        if (!store.hasBlock(block.id))
          throw new Error(
            'A snapshot block could not be restored. No pages were imported.'
          );
      });
      stagedIds.push(store.id);
    }
    return await publishStagedWorkspace(collection, staging, stagedIds, signal);
  } finally {
    job[Symbol.dispose]();
    staging.dispose();
    staging.doc.destroy();
  }
}

/** Publish fully prepared import documents with their required local assets. */
export async function publishStagedWorkspace(
  collection: Workspace,
  staging: Workspace,
  docIds: readonly string[] = [...staging.docs.keys()],
  signal?: AbortSignal
): Promise<Store[]> {
  signal?.throwIfAborted();
  const prepared = docIds.map(id => {
    const doc = staging.getDoc(id);
    if (!doc) throw new Error('A prepared import document is missing.');
    const store = doc.getStore({ id });
    const snapshot = store.getTransformer().docToSnapshot(store);
    if (!snapshot)
      throw new Error('A prepared import document could not be serialized.');
    return {
      id,
      snapshot,
      update: encodeStateAsUpdate(store.spaceDoc),
      meta: doc.meta
        ? JSON.parse(JSON.stringify(doc.meta))
        : { title: snapshot.meta.title },
    };
  });
  const required = new Set(
    prepared.flatMap(entry => [...snapshotBlobIds(entry.snapshot)])
  );
  const assets = new Map<string, Blob>();
  // Check all identities and required blobs before changing live storage.
  for (const entry of prepared)
    if (collection.getDoc(entry.id))
      throw new Error('An imported document identity is already in use.');
  for (const id of required) {
    signal?.throwIfAborted();
    const blob = await staging.blobSync.get(id);
    if (!blob)
      throw new Error(
        'The prepared import is missing a required attachment. No pages were imported.'
      );
    const existing = await collection.blobSync.get(id);
    if (
      existing &&
      (await sha(await existing.arrayBuffer())) !==
        (await sha(await blob.arrayBuffer()))
    )
      throw new Error(
        'An attachment identity conflicts with existing local data. No pages were imported.'
      );
    assets.set(id, blob);
  }
  for (const [id, blob] of assets) {
    signal?.throwIfAborted();
    await collection.blobSync.set(id, blob);
  }
  signal?.throwIfAborted();
  const created: string[] = [];
  try {
    const result: Store[] = [];
    // All deltas are encoded after every staged import has completed, including
    // deferred reference remapping. Publication contains no await between docs.
    for (const entry of prepared) {
      if (collection.getDoc(entry.id))
        throw new Error('An imported document identity is already in use.');
      created.push(entry.id);
      const doc = collection.createDoc(entry.id);
      doc.load();
      const store = doc.getStore({ id: entry.id });
      applyUpdate(store.spaceDoc, entry.update, store.spaceDoc.clientID);
      collection.meta.setDocMeta(entry.id, entry.meta);
      result.push(store);
    }
    return result;
  } catch (error) {
    for (const id of created)
      if (collection.getDoc(id)) collection.removeDoc(id);
    throw error;
  }
}

export const ZipTransformer = {
  exportDocs,
  importDocs,
};
