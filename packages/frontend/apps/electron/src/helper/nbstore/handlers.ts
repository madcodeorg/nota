import path from 'node:path';

import { DocStoragePool } from '@nota/native';
import { parseUniversalId } from '@nota/nbstore';
import type { NativeDBApis } from '@nota/nbstore/sqlite';
import fs from 'fs-extra';

import { getSpaceDBPath } from '../workspace/meta';

const POOL = new DocStoragePool();

export function getDocStoragePool() {
  return POOL;
}

export const nbstoreHandlers: NativeDBApis = {
  connect: async (universalId: string) => {
    const { peer, type, id } = parseUniversalId(universalId);
    const dbPath = await getSpaceDBPath(peer, type, id);
    await fs.ensureDir(path.dirname(dbPath));
    await POOL.connect(universalId, dbPath);
    await POOL.setSpaceId(universalId, id);
  },
  disconnect: POOL.disconnect.bind(POOL),
  pushUpdate: POOL.pushUpdate.bind(POOL),
  hasDocHistory: async () =>
    typeof POOL.getDocHistory === 'function' &&
    typeof POOL.pushUpdateForRollback === 'function' &&
    typeof POOL.getDocHistoryStorageUsage === 'function' &&
    typeof POOL.clearDocHistories === 'function',
  pushUpdateForRollback: POOL.pushUpdateForRollback?.bind(POOL),
  listDocHistories: POOL.listDocHistories?.bind(POOL),
  getDocHistory: POOL.getDocHistory?.bind(POOL),
  createDocHistory: POOL.createDocHistory?.bind(POOL),
  deleteDocHistory: POOL.deleteDocHistory?.bind(POOL),
  getDocHistoryStorageUsage: POOL.getDocHistoryStorageUsage?.bind(POOL),
  clearDocHistories: POOL.clearDocHistories?.bind(POOL),
  getDocSnapshot: POOL.getDocSnapshot.bind(POOL),
  setDocSnapshot: POOL.setDocSnapshot.bind(POOL),
  getDocUpdates: POOL.getDocUpdates.bind(POOL),
  markUpdatesMerged: POOL.markUpdatesMerged.bind(POOL),
  deleteDoc: POOL.deleteDoc.bind(POOL),
  getDocClocks: POOL.getDocClocks.bind(POOL),
  getDocClock: POOL.getDocClock.bind(POOL),
  getDocIndexedClock: POOL.getDocIndexedClock.bind(POOL),
  setDocIndexedClock: POOL.setDocIndexedClock.bind(POOL),
  clearDocIndexedClock: POOL.clearDocIndexedClock.bind(POOL),
  getBlob: POOL.getBlob.bind(POOL),
  setBlob: POOL.setBlob.bind(POOL),
  deleteBlob: POOL.deleteBlob.bind(POOL),
  releaseBlobs: POOL.releaseBlobs.bind(POOL),
  listBlobs: POOL.listBlobs.bind(POOL),
  getPeerRemoteClocks: POOL.getPeerRemoteClocks.bind(POOL),
  getPeerRemoteClock: POOL.getPeerRemoteClock.bind(POOL),
  setPeerRemoteClock: POOL.setPeerRemoteClock.bind(POOL),
  getPeerPulledRemoteClocks: POOL.getPeerPulledRemoteClocks.bind(POOL),
  getPeerPulledRemoteClock: POOL.getPeerPulledRemoteClock.bind(POOL),
  setPeerPulledRemoteClock: POOL.setPeerPulledRemoteClock.bind(POOL),
  getPeerPushedClocks: POOL.getPeerPushedClocks.bind(POOL),
  getPeerPushedClock: POOL.getPeerPushedClock.bind(POOL),
  setPeerPushedClock: POOL.setPeerPushedClock.bind(POOL),
  clearClocks: POOL.clearClocks.bind(POOL),
  setBlobUploadedAt: POOL.setBlobUploadedAt.bind(POOL),
  getBlobUploadedAt: POOL.getBlobUploadedAt.bind(POOL),
  // Use nbstore's existing JS crawler; the removed EE parser is not bundled.
  crawlDocData: async () => null,
  ftsAddDocument: POOL.ftsAddDocument.bind(POOL),
  ftsDeleteDocument: POOL.ftsDeleteDocument.bind(POOL),
  ftsSearch: POOL.ftsSearch.bind(POOL),
  ftsGetDocument: POOL.ftsGetDocument.bind(POOL),
  ftsGetMatches: POOL.ftsGetMatches.bind(POOL),
  ftsFlushIndex: POOL.ftsFlushIndex.bind(POOL),
  ftsIndexVersion: POOL.ftsIndexVersion.bind(POOL),
};
