import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { IndexedDBDocStorage } from './doc';

let storage: IndexedDBDocStorage;
let disposeSubscription: () => void;
const update = {
  bin: new Uint8Array([0, 0]),
  docId: 'meeting-note',
  editor: 'local-editor',
};

beforeEach(async () => {
  storage = new IndexedDBDocStorage({
    flavour: 'local',
    id: crypto.randomUUID(),
    type: 'workspace',
  });
  storage.connection.connect();
  await storage.connection.waitForConnected();
  disposeSubscription = () => {};
});

afterEach(() => {
  disposeSubscription();
  vi.restoreAllMocks();
  storage.connection.disconnect();
});

function observeUpdates() {
  const listener = vi.fn();
  disposeSubscription = storage.subscribeDocUpdate(listener);
  const broadcast = vi.spyOn(storage.channel, 'postMessage');
  return { broadcast, listener };
}

function controlledTransaction() {
  let complete!: () => void;
  let abort!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    complete = resolve;
    abort = reject;
  });
  const store = {
    get: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  return {
    abort,
    complete,
    store,
    transaction: {
      commit: vi.fn(),
      done,
      objectStore: vi.fn().mockReturnValue(store),
    },
  };
}

function mockTransactions(
  ...transactions: ReturnType<typeof controlledTransaction>[]
) {
  const transaction = vi.fn();
  for (const item of transactions) {
    transaction.mockReturnValueOnce(item.transaction);
  }
  vi.spyOn(storage, 'db', 'get').mockReturnValue({
    transaction,
  } as unknown as IndexedDBDocStorage['db']);
  return transaction;
}

describe('IndexedDB document update acknowledgements', () => {
  test('waits for transaction completion before returning or notifying observers', async () => {
    const { broadcast, listener } = observeUpdates();
    const controlled = controlledTransaction();
    mockTransactions(controlled);
    const succeeded = vi.fn();
    const saving = storage
      .pushDocUpdate(update, 'meeting-save')
      .then(result => {
        succeeded(result);
        return result;
      });

    await vi.waitFor(() => {
      expect(controlled.transaction.commit).toHaveBeenCalledOnce();
    });
    expect(succeeded).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    controlled.complete();
    const clock = await saving;
    expect(succeeded).toHaveBeenCalledOnce();
    expect(clock).toEqual({ docId: update.docId, timestamp: expect.any(Date) });
    expect(listener).toHaveBeenCalledExactlyOnceWith(
      { ...update, timestamp: clock.timestamp },
      'meeting-save'
    );
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      origin: 'meeting-save',
      type: 'update',
      update: { ...update, timestamp: clock.timestamp },
    });
  });

  test('rejects failed transaction completion without emitting a success event', async () => {
    const { broadcast, listener } = observeUpdates();
    const controlled = controlledTransaction();
    mockTransactions(controlled);
    const succeeded = vi.fn();
    const failed = vi.fn();
    const saving = storage.pushDocUpdate(update).then(succeeded, failed);
    await vi.waitFor(() => {
      expect(controlled.transaction.commit).toHaveBeenCalledOnce();
    });

    const error = new DOMException('Transaction aborted', 'AbortError');
    controlled.abort(error);
    await saving;
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(succeeded).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('waits for a retried transaction after a late constraint failure', async () => {
    const { broadcast, listener } = observeUpdates();
    const first = controlledTransaction();
    const retry = controlledTransaction();
    const transactions = mockTransactions(first, retry);
    const saving = storage.pushDocUpdate(update);
    await vi.waitFor(() => {
      expect(first.transaction.commit).toHaveBeenCalledOnce();
    });
    first.abort(new DOMException('Duplicate timestamp', 'ConstraintError'));
    await vi.waitFor(() => {
      expect(retry.transaction.commit).toHaveBeenCalledOnce();
    });
    expect(listener).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    retry.complete();
    const clock = await saving;
    const firstTimestamp = first.store.add.mock.calls[0][0].createdAt as Date;
    expect(clock.timestamp.getTime()).toBe(firstTimestamp.getTime() + 1);
    expect(transactions).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  test('acknowledges an actual IDB transaction with both update and clock committed', async () => {
    const { listener } = observeUpdates();
    const clock = await storage.pushDocUpdate(update);
    expect(await storage.db.get('clocks', update.docId)).toEqual(clock);
    expect(
      await storage.db.getAllFromIndex('updates', 'docId', update.docId)
    ).toEqual([{ ...update, createdAt: clock.timestamp }]);
    expect(listener).toHaveBeenCalledOnce();
  });
});
