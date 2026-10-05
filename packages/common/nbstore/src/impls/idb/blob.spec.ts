import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { IndexedDBBlobStorage } from './blob';

let storage: IndexedDBBlobStorage;
const blob = {
  key: 'meeting-recording',
  mime: 'audio/mp4',
  data: new Uint8Array([1, 2, 3]),
};

beforeEach(async () => {
  storage = new IndexedDBBlobStorage({
    flavour: 'local',
    id: crypto.randomUUID(),
    type: 'workspace',
  });
  storage.connection.connect();
  await storage.connection.waitForConnected();
});

afterEach(() => {
  vi.restoreAllMocks();
  storage.connection.disconnect();
});

function controlledTransaction() {
  let complete!: () => void;
  let abort!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    complete = resolve;
    abort = reject;
  });
  const put = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(storage, 'db', 'get').mockReturnValue({
    transaction: () => ({
      done,
      objectStore: () => ({ put }),
    }),
  } as unknown as IndexedDBBlobStorage['db']);
  return { abort, complete, put };
}

describe('IndexedDB recording blob acknowledgements', () => {
  test('waits for commit after both blob requests succeed', async () => {
    const transaction = controlledTransaction();
    const succeeded = vi.fn();
    const saving = storage.set(blob).then(succeeded);

    await vi.waitFor(() => {
      expect(transaction.put).toHaveBeenCalledTimes(2);
    });
    expect(succeeded).not.toHaveBeenCalled();
    transaction.complete();
    await saving;
    expect(succeeded).toHaveBeenCalledOnce();
  });

  test('rejects when the transaction aborts after successful requests', async () => {
    const transaction = controlledTransaction();
    const succeeded = vi.fn();
    const failed = vi.fn();
    const saving = storage.set(blob).then(succeeded, failed);
    const error = new DOMException('Commit failed', 'AbortError');

    transaction.abort(error);
    await saving;
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(succeeded).not.toHaveBeenCalled();
  });

  test('handles request and transaction failures without acknowledging a blob', async () => {
    const transaction = controlledTransaction();
    const error = new DOMException('Storage full', 'QuotaExceededError');
    transaction.put.mockRejectedValueOnce(error);
    const saving = expect(storage.set(blob)).rejects.toBe(error);

    transaction.abort(new DOMException('Transaction aborted', 'AbortError'));
    await saving;
  });

  test('persists metadata and bytes before acknowledging an actual transaction', async () => {
    await storage.set(blob);
    expect(await storage.get(blob.key)).toMatchObject({
      ...blob,
      size: blob.data.byteLength,
    });
  });
});
