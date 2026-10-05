import type { Workspace } from '@blocksuite/affine/store';
import { publishStagedWorkspace } from '@blocksuite/affine/widgets/linked-doc';

/** Conversion adapters can swallow errors; require every selected file to succeed. */
export async function importFiles(
  files: File[],
  convert: (file: File) => Promise<string | undefined>
): Promise<string[]> {
  const docIds: string[] = [];
  for (const file of files) {
    const docId = await convert(file);
    if (docId === undefined)
      throw new Error(
        `The file "${file.name}" could not be imported. No pages were imported.`
      );
    docIds.push(docId);
  }
  return docIds;
}

/** Prepare the complete import before publishing any local pages or assets. */
export async function stageContentImport<T extends { docIds: string[] }>(
  collection: Workspace,
  prepare: (staging: Workspace) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  const staging = collection.createStagingWorkspace?.();
  if (!staging)
    throw new Error('This workspace cannot stage a content import safely.');
  try {
    const result = await prepare(staging);
    signal?.throwIfAborted();
    if (!result.docIds.length)
      throw new Error(
        'The import contains no supported documents. No pages were imported.'
      );
    await publishStagedWorkspace(collection, staging, result.docIds, signal);
    return result;
  } finally {
    try {
      staging.dispose();
    } finally {
      staging.doc.destroy();
    }
  }
}
