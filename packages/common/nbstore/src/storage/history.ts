import {
  applyUpdate,
  Doc,
  encodeStateAsUpdate,
  encodeStateVector,
  UndoManager,
} from 'yjs';

import {
  type DocClock,
  type DocRecord,
  DocStorageBase,
  type DocStorageOptions,
  type DocUpdate,
} from './doc';
import { collectCurrentContentStrings } from './history-assets';

export { collectCurrentContentStrings } from './history-assets';

export interface HistoryFilter {
  before?: Date;
  limit?: number;
}

export interface ListedHistory {
  userId: string | null;
  timestamp: Date;
}

export interface HistoryStorageUsage {
  versions: number;
  historyBytes: number;
  retainedRemovedBlobBytes: number;
}

export interface HistoryCleanupProtection {
  expectedDocClocks: DocClock[];
  protectedBlobKeys: string[];
  preserveAllRemovedBlobs: boolean;
}

/** Keep two recovery points even when a large page exceeds the byte budget. */
export const LOCAL_HISTORY_LIMIT = 50;
export const LOCAL_HISTORY_MAX_BYTES = 50 * 1024 * 1024;
export const LOCAL_HISTORY_INTERVAL_MS = 5 * 60 * 1000;

export function equalDocContent(a: Uint8Array, b: Uint8Array): boolean {
  const left = new Doc({ gc: false });
  const right = new Doc({ gc: false });
  try {
    applyUpdate(left, a);
    applyUpdate(right, b);
    const leftUpdate = encodeStateAsUpdate(left);
    const rightUpdate = encodeStateAsUpdate(right);
    return (
      leftUpdate.length === rightUpdate.length &&
      leftUpdate.every((byte, index) => byte === rightUpdate[index])
    );
  } finally {
    left.destroy();
    right.destroy();
  }
}

/** A historical update is immutable and carries content, not a state-vector marker. */
export abstract class HistoricalDocStorage<
  Options extends DocStorageOptions = DocStorageOptions,
> extends DocStorageBase<Options> {
  async isHistorySupported(): Promise<boolean> {
    return true;
  }
  abstract listHistories(
    docId: string,
    filter?: HistoryFilter
  ): Promise<ListedHistory[]>;
  abstract getHistory(
    docId: string,
    timestamp: Date
  ): Promise<DocRecord | null>;
  abstract deleteHistory(docId: string, timestamp: Date): Promise<void>;
  abstract getHistoryStorageUsage(): Promise<HistoryStorageUsage>;
  async clearHistories(): Promise<void> {
    if (this.isReadonly) throw new Error('Cannot clear read-only storage.');
    const clocks = await this.getDocTimestamps();
    const canonicalDocIds = new Set(Object.keys(clocks));
    const protectedBlobKeys = new Set<string>();
    let preserveAllRemovedBlobs = false;
    for (const docId of Object.keys(clocks)) {
      const current = await this.getDoc(docId);
      if (!current) {
        preserveAllRemovedBlobs = true;
        continue;
      }
      const protection = collectCurrentContentStrings(
        current.bin,
        canonicalDocIds
      );
      for (const key of protection.strings) protectedBlobKeys.add(key);
      preserveAllRemovedBlobs ||= protection.preserveAll;
    }
    await this.clearHistoriesWithProtection({
      expectedDocClocks: Object.entries(clocks).map(([docId, timestamp]) => ({
        docId,
        timestamp,
      })),
      protectedBlobKeys: [...protectedBlobKeys],
      preserveAllRemovedBlobs,
    });
  }
  protected abstract clearHistoriesWithProtection(
    protection: HistoryCleanupProtection
  ): Promise<void>;

  async createCheckpoint(docId: string): Promise<DocRecord | null> {
    if (this.isReadonly)
      throw new Error('Cannot checkpoint read-only storage.');
    const snapshot = await this.getDoc(docId);
    if (snapshot) await this.createHistory(docId, snapshot);
    return snapshot;
  }

  async rollbackDoc(
    docId: string,
    timestamp: Date,
    editor?: string,
    expectedCurrent?: Uint8Array
  ): Promise<void> {
    if (this.isReadonly) throw new Error('Cannot restore read-only storage.');
    const toSnapshot = await this.getHistory(docId, timestamp);
    if (!toSnapshot) throw new Error('Cannot find the version to restore.');
    const fromSnapshot = await this.createCheckpoint(docId);
    if (!fromSnapshot) throw new Error('Cannot find the current page.');
    if (
      expectedCurrent &&
      !equalDocContent(fromSnapshot.bin, expectedCurrent)
    ) {
      throw new Error(
        'The page changed. Refresh its history before restoring.'
      );
    }
    const change = this.generateRevertUpdate(fromSnapshot.bin, toSnapshot.bin);
    // The adapter checks the clock in the same transaction that stores the update.
    await this.pushDocUpdateForRollback(
      { docId, bin: change, editor },
      fromSnapshot.timestamp
    );
  }

  protected abstract createHistory(
    docId: string,
    snapshot: DocRecord
  ): Promise<void>;
  protected abstract pushDocUpdateForRollback(
    update: DocUpdate,
    expectedTimestamp: Date
  ): Promise<DocClock>;

  protected generateRevertUpdate(
    fromNewerBin: Uint8Array,
    toOlderBin: Uint8Array
  ): Uint8Array {
    const newerDoc = new Doc({ gc: false });
    const olderDoc = new Doc({ gc: false });
    let undoManager: UndoManager | undefined;
    try {
      applyUpdate(newerDoc, fromNewerBin);
      applyUpdate(olderDoc, toOlderBin);
      // Root types introduced after the historical version must also be undone.
      for (const key of new Set([
        ...newerDoc.share.keys(),
        ...olderDoc.share.keys(),
      ])) {
        // Updates do not encode the constructor of root types. Hydrate roots so
        // their observers populate changedParentTypes for UndoManager tracking.
        // A map observer covers both map keys and sequence changes; encoded
        // content keeps its original Text/Array/Map representation.
        olderDoc.getMap(key);
      }
      undoManager = new UndoManager([...olderDoc.share.values()], {
        doc: olderDoc,
        ignoreRemoteMapChanges: true,
      });
      const newerState = encodeStateVector(newerDoc);
      applyUpdate(
        olderDoc,
        encodeStateAsUpdate(newerDoc, encodeStateVector(olderDoc))
      );
      undoManager.undo();
      return encodeStateAsUpdate(olderDoc, newerState);
    } finally {
      undoManager?.destroy();
      newerDoc.destroy();
      olderDoc.destroy();
    }
  }
}
