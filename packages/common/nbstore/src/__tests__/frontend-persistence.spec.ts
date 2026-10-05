import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc, encodeStateAsUpdate } from 'yjs';

import {
  DocFrontend,
  type DocFrontendDocState,
  type DocFrontendState,
} from '../frontend/doc';
import { IndexedDBDocStorage } from '../impls/idb';
import { DocSyncImpl } from '../sync/doc';
import { MANUALLY_STOP } from '../utils/throw-if-aborted';
import { StoreClient } from '../worker/client';
import { expectYjsEqual } from './utils';

let storage: IndexedDBDocStorage;
let frontend: DocFrontend;
let docs: YDoc[];

beforeEach(async () => {
  storage = new IndexedDBDocStorage({
    flavour: 'local',
    id: crypto.randomUUID(),
    type: 'workspace',
  });
  storage.connection.connect();
  await storage.connection.waitForConnected();
  frontend = new DocFrontend(storage, DocSyncImpl.dummy);
  docs = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  frontend.stop();
  for (const doc of docs) {
    doc.destroy();
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  storage.connection.disconnect();
  vi.restoreAllMocks();
});

function connectDoc(id: string) {
  const doc = new YDoc({ guid: id });
  docs.push(doc);
  frontend.connectDoc(doc);
  return doc;
}

function observeWait(docId?: string) {
  const succeeded = vi.fn();
  const failed = vi.fn();
  const settled = frontend.waitForUpdated(docId).then(succeeded, failed);
  return { failed, settled, succeeded };
}

function blockedWrite() {
  let release!: () => void;
  let reject!: (error: Error) => void;
  const gate = new Promise<void>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  const pushDocUpdate = storage.pushDocUpdate.bind(storage);
  const push = vi
    .spyOn(storage, 'pushDocUpdate')
    .mockImplementationOnce(async (update, origin) => {
      await gate;
      return pushDocUpdate(update, origin);
    });
  return { push, reject, release };
}

function persistenceState(docId?: string) {
  let latest!: DocFrontendState | DocFrontendDocState;
  const next = (state: DocFrontendState | DocFrontendDocState) => {
    latest = state;
  };
  const subscription = docId
    ? frontend.docState$(docId).subscribe(next)
    : frontend.state$.subscribe(next);
  subscription.unsubscribe();
  return latest;
}

describe('DocFrontend local persistence waits', () => {
  test('emits local-only workspace state without requiring a remote sync peer', async () => {
    expect(persistenceState()).toMatchObject({
      total: 0,
      loaded: 0,
      updating: false,
      synced: true,
      persistenceErrorMessage: null,
      persistenceRetrying: false,
    });
    frontend.start();
    const doc = connectDoc('local-only');
    await frontend.waitForUpdated();
    expect(persistenceState()).toMatchObject({ total: 1, loaded: 1 });
    const write = blockedWrite();
    doc.getMap('test').set('text', 'Only local storage is required');
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    expect(persistenceState()).toMatchObject({ updating: true, synced: true });
    write.release();
    await frontend.waitForUpdated();
    expect(persistenceState()).toMatchObject({ updating: false, synced: true });
  });

  test('resolves untouched documents and waits for successful storage completion', async () => {
    frontend.start();
    await frontend.waitForUpdated('untouched-doc');
    const doc = connectDoc('saved-doc');
    await frontend.waitForUpdated(doc.guid);
    const write = blockedWrite();
    doc.getMap('test').set('text', 'Saved transcript');
    const waiter = observeWait(doc.guid);
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    expect(waiter.succeeded).not.toHaveBeenCalled();
    write.release();
    await waiter.settled;
    expect(waiter.succeeded).toHaveBeenCalledOnce();
    expect(waiter.failed).not.toHaveBeenCalled();
    expectYjsEqual((await storage.getDoc(doc.guid))!.bin, {
      test: { text: 'Saved transcript' },
    });
  });

  test('rejects document and global waits while retaining a disconnected queued write', async () => {
    // Do not start the consumer until after the queued document is disconnected.
    const doc = connectDoc('queued-doc');
    doc.getMap('test').set('text', 'Pending transcript');
    const push = vi.spyOn(storage, 'pushDocUpdate');
    const documentWait = observeWait(doc.guid);
    const globalWait = observeWait();
    const loadWait = expect(
      frontend.waitForDocLoaded(doc.guid)
    ).rejects.toThrow('disconnected before local persistence');
    frontend.disconnectDoc(doc);
    await Promise.all([documentWait.settled, globalWait.settled, loadWait]);
    for (const waiter of [documentWait, globalWait]) {
      expect(waiter.succeeded).not.toHaveBeenCalled();
      expect(waiter.failed).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            'disconnected before local persistence'
          ),
        })
      );
    }
    expect(push).not.toHaveBeenCalled();
    await expect(frontend.waitForUpdated(doc.guid)).rejects.toThrow(
      'disconnected before local persistence'
    );
    await expect(frontend.waitForUpdated()).rejects.toThrow(
      'disconnected before local persistence'
    );
    await frontend.waitForUpdated('untouched-doc');

    frontend.start();
    // A fresh YDoc proves recovery uses retained jobs, not the old YDoc state.
    const replacement = connectDoc(doc.guid);
    doc.destroy();
    await frontend.waitForDocLoaded(replacement.guid);
    expectYjsEqual(replacement, { test: { text: 'Pending transcript' } });
    await frontend.waitForUpdated(doc.guid);
    await frontend.waitForUpdated();
    expectYjsEqual((await storage.getDoc(doc.guid))!.bin, {
      test: { text: 'Pending transcript' },
    });
  });

  test('does not consume retained saves when storage notifies a disconnected document', async () => {
    const doc = connectDoc('disconnected-doc');
    doc.getMap('test').set('local', 'Unsaved local transcript');
    doc.destroy();
    frontend.start();
    const sentinel = connectDoc('sentinel-doc');
    await frontend.waitForUpdated(sentinel.guid);
    const save = vi.spyOn(frontend.jobs, 'save');
    const external = new YDoc();
    docs.push(external);
    external.getMap('test').set('remote', 'Persisted external transcript');
    await storage.pushDocUpdate(
      { docId: doc.guid, bin: encodeStateAsUpdate(external) },
      'another-frontend'
    );
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(save).not.toHaveBeenCalled();
    await expect(frontend.waitForUpdated(doc.guid)).rejects.toThrow(
      'disconnected before local persistence'
    );

    const replacement = connectDoc(doc.guid);
    await frontend.waitForDocLoaded(replacement.guid);
    const expected = {
      test: {
        local: 'Unsaved local transcript',
        remote: 'Persisted external transcript',
      },
    };
    expectYjsEqual(replacement, expected);
    await frontend.waitForUpdated(replacement.guid);
    expectYjsEqual((await storage.getDoc(replacement.guid))!.bin, expected);
  });

  test('does not mark a replacement loaded when an old disconnected load completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const getDoc = storage.getDoc.bind(storage);
    const read = vi
      .spyOn(storage, 'getDoc')
      .mockImplementationOnce(async id => {
        await gate;
        return getDoc(id);
      });
    frontend.start();
    const original = connectDoc('replaced-during-load');
    original.getMap('test').set('text', 'Retained during load');
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    original.destroy();
    const replacement = connectDoc(original.guid);
    const loaded = frontend.waitForDocLoaded(replacement.guid).then(() => {
      expectYjsEqual(replacement, {
        test: { text: 'Retained during load' },
      });
    });
    release();
    await loaded;
    await frontend.waitForUpdated(replacement.guid);
    expectYjsEqual((await storage.getDoc(replacement.guid))!.bin, {
      test: { text: 'Retained during load' },
    });
  });

  test('rejects an in-flight write wait on disconnect even if storage later completes', async () => {
    frontend.start();
    const doc = connectDoc('in-flight-doc');
    await frontend.waitForUpdated(doc.guid);
    const write = blockedWrite();
    doc.getMap('test').set('text', 'In-flight transcript');
    const waiter = observeWait(doc.guid);
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    frontend.disconnectDoc(doc);
    await waiter.settled;
    expect(waiter.succeeded).not.toHaveBeenCalled();
    expect(waiter.failed).toHaveBeenCalledOnce();
    write.release();
    await write.push.mock.results[0].value;
    await expect(frontend.waitForUpdated(doc.guid)).rejects.toThrow(
      'disconnected before local persistence'
    );
  });

  test('rejects active, queued and future waits when the storage writer fails', async () => {
    frontend.start();
    const active = connectDoc('active-doc');
    const queued = connectDoc('queued-doc');
    await frontend.waitForUpdated();
    const write = blockedWrite();
    active.getMap('test').set('text', 'Active transcript');
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    queued.getMap('test').set('text', 'Queued transcript');
    const waiters = [
      observeWait(active.guid),
      observeWait(queued.guid),
      observeWait(),
    ];
    const error = new Error('Local disk write failed');
    write.reject(error);
    await Promise.all(waiters.map(waiter => waiter.settled));
    for (const waiter of waiters) {
      expect(waiter.succeeded).not.toHaveBeenCalled();
      expect(waiter.failed).toHaveBeenCalledExactlyOnceWith(error);
    }
    await expect(frontend.waitForUpdated(active.guid)).rejects.toBe(error);
    await expect(frontend.waitForUpdated()).rejects.toBe(error);
    expect(write.push).toHaveBeenCalledOnce();
    await expect(frontend.waitForDocLoaded(active.guid)).rejects.toBe(error);
    let updating = false;
    const subscription = frontend.docState$(active.guid).subscribe(state => {
      updating = state.updating;
    });
    // Failed work remains pending; only the waiter rejects, never succeeds.
    expect(updating).toBe(true);
    subscription.unsubscribe();
  });

  test('rejects pending waits promptly when stopped during an unresolved write', async () => {
    frontend.start();
    const doc = connectDoc('stopped-doc');
    await frontend.waitForUpdated(doc.guid);
    const write = blockedWrite();
    doc.getMap('test').set('text', 'Pending transcript');
    const documentWait = observeWait(doc.guid);
    const globalWait = observeWait();
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    frontend.stop();
    await Promise.all([documentWait.settled, globalWait.settled]);
    for (const waiter of [documentWait, globalWait]) {
      expect(waiter.succeeded).not.toHaveBeenCalled();
      expect(waiter.failed).toHaveBeenCalledExactlyOnceWith(MANUALLY_STOP);
    }
    write.release();
    await write.push.mock.results[0].value;
    await expect(frontend.waitForUpdated(doc.guid)).rejects.toBe(MANUALLY_STOP);
  });

  test('preserves caller cancellation without terminating the writer', async () => {
    frontend.start();
    const doc = connectDoc('cancelled-wait-doc');
    await frontend.waitForUpdated(doc.guid);
    const write = blockedWrite();
    doc.getMap('test').set('text', 'Still saving');
    const abort = new AbortController();
    const error = new Error('Caller cancelled');
    const cancelled = expect(
      frontend.waitForUpdated(doc.guid, abort.signal)
    ).rejects.toBe(error);
    abort.abort(error);
    await cancelled;
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    write.release();
    await frontend.waitForUpdated(doc.guid);
  });

  test('rejects load and update waits when the local load fails', async () => {
    const error = new Error('Local document read failed');
    vi.spyOn(storage, 'getDoc').mockRejectedValueOnce(error);
    const doc = connectDoc('failed-load-doc');
    const loaded = expect(frontend.waitForDocLoaded(doc.guid)).rejects.toBe(
      error
    );
    const updated = expect(frontend.waitForUpdated(doc.guid)).rejects.toBe(
      error
    );
    frontend.start();
    await Promise.all([loaded, updated]);
  });

  test('rejects load waiters when stopped before a queued load runs', async () => {
    const doc = connectDoc('stopped-load-doc');
    const loaded = expect(frontend.waitForDocLoaded(doc.guid)).rejects.toBe(
      MANUALLY_STOP
    );
    frontend.stop();
    await loaded;
  });

  test('retries retained active and queued writes once, including edits made during recovery', async () => {
    frontend.start();
    const active = connectDoc('recovery-active');
    const queued = connectDoc('recovery-queued');
    await frontend.waitForUpdated();
    const undoPriority = frontend.addPriority(active.guid, 1);
    const failedWrite = blockedWrite();
    active.getMap('test').set('text', 'First edit');
    await vi.waitFor(() => expect(failedWrite.push).toHaveBeenCalledOnce());
    queued.getMap('test').set('text', 'Queued edit');
    const originalWait = observeWait();
    const error = new Error('Disk is full');
    failedWrite.reject(error);
    await originalWait.settled;
    expect(originalWait.failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(persistenceState()).toMatchObject({
      updating: true,
      persistenceErrorMessage: error.message,
      persistenceRetrying: false,
      syncErrorMessage: null,
    });
    expect(persistenceState(queued.guid)).toMatchObject({
      loaded: true,
      persistenceErrorMessage: error.message,
    });
    failedWrite.push.mockRestore();

    active.getMap('test').set('whileFailed', 'Edit after failed save');
    const recoveryWrite = blockedWrite();
    const retry = frontend.retryPersistence();
    expect(frontend.retryPersistence()).toBe(retry);
    const recoveryWait = observeWait();
    await vi.waitFor(() => expect(recoveryWrite.push).toHaveBeenCalledOnce());
    active.getMap('test').set('duringRetry', 'Edit while retrying');
    queued.getMap('test').set('duringRetry', 'Queued while retrying');
    expect(persistenceState(active.guid)).toMatchObject({
      loaded: true,
      updating: true,
      persistenceRetrying: true,
      persistenceErrorMessage: error.message,
    });
    expect(recoveryWait.succeeded).not.toHaveBeenCalled();
    recoveryWrite.release();
    await Promise.all([retry, recoveryWait.settled]);
    expect(recoveryWait.failed).not.toHaveBeenCalled();
    expect(originalWait.succeeded).not.toHaveBeenCalled();
    expect(persistenceState()).toMatchObject({
      updating: false,
      persistenceRetrying: false,
      persistenceErrorMessage: null,
    });
    const expectedActive = {
      test: {
        text: 'First edit',
        whileFailed: 'Edit after failed save',
        duringRetry: 'Edit while retrying',
      },
    };
    expectYjsEqual(active, expectedActive);
    expectYjsEqual((await storage.getDoc(active.guid))!.bin, expectedActive);
    expectYjsEqual((await storage.getDoc(queued.guid))!.bin, {
      test: { text: 'Queued edit', duringRetry: 'Queued while retrying' },
    });
    undoPriority();

    // Fresh frontend and YDoc demonstrate acknowledged edits survive reopening.
    frontend.stop();
    await new Promise<void>(resolve => setImmediate(resolve));
    frontend = new DocFrontend(storage, DocSyncImpl.dummy);
    frontend.start();
    const reopened = connectDoc(active.guid);
    await frontend.waitForDocLoaded(reopened.guid);
    expectYjsEqual(reopened, expectedActive);
  });

  test('rejects a failed retry without acknowledging data and allows another explicit retry', async () => {
    frontend.start();
    const doc = connectDoc('repeat-recovery');
    await frontend.waitForUpdated();
    const push = vi.spyOn(storage, 'pushDocUpdate');
    const firstError = new Error('Disk full');
    const secondError = new Error('Still full');
    push.mockRejectedValueOnce(firstError).mockRejectedValueOnce(secondError);
    doc.getMap('test').set('text', 'Must remain recoverable');
    await expect(frontend.waitForUpdated()).rejects.toBe(firstError);
    const retry = frontend.retryPersistence();
    const waiter = expect(frontend.waitForUpdated()).rejects.toBe(secondError);
    await expect(retry).rejects.toBe(secondError);
    await waiter;
    expect(push).toHaveBeenCalledTimes(2);
    expect(persistenceState()).toMatchObject({
      updating: true,
      persistenceErrorMessage: secondError.message,
      persistenceRetrying: false,
    });
    await expect(frontend.waitForUpdated()).rejects.toBe(secondError);
    await frontend.retryPersistence();
    expect(push).toHaveBeenCalledTimes(3);
    expectYjsEqual((await storage.getDoc(doc.guid))!.bin, {
      test: { text: 'Must remain recoverable' },
    });
  });

  test('retries a failed local load without replacing the live document or losing new edits', async () => {
    const error = new Error('Temporary read failure');
    const read = vi.spyOn(storage, 'getDoc').mockRejectedValueOnce(error);
    const doc = connectDoc('recover-load');
    doc.getMap('test').set('beforeLoad', 'Existing edit');
    frontend.start();
    await expect(frontend.waitForDocLoaded(doc.guid)).rejects.toBe(error);
    doc.getMap('test').set('afterFailure', 'New edit');
    const retry = frontend.retryPersistence();
    await frontend.waitForDocLoaded(doc.guid);
    await retry;
    expect(read).toHaveBeenCalledTimes(2);
    const expected = {
      test: { beforeLoad: 'Existing edit', afterFailure: 'New edit' },
    };
    expectYjsEqual(doc, expected);
    expectYjsEqual((await storage.getDoc(doc.guid))!.bin, expected);
  });

  test('reloads edits saved by another window while the writer was failed', async () => {
    frontend.start();
    const doc = connectDoc('two-window-recovery');
    await frontend.waitForUpdated();
    const otherWindow = new DocFrontend(storage, DocSyncImpl.dummy);
    const otherDoc = new YDoc({ guid: doc.guid });
    docs.push(otherDoc);
    otherWindow.connectDoc(otherDoc);
    otherWindow.start();
    try {
      await otherWindow.waitForUpdated();
      const error = new Error('Temporary write failure');
      vi.spyOn(storage, 'pushDocUpdate').mockRejectedValueOnce(error);
      doc.getMap('test').set('local', 'Retained local edit');
      await expect(frontend.waitForUpdated()).rejects.toBe(error);

      otherDoc.getMap('test').set('otherWindow', 'Saved in another window');
      await otherWindow.waitForUpdated();
      expect(doc.getMap('test').has('otherWindow')).toBe(false);
      await frontend.retryPersistence();
      await otherWindow.waitForUpdated();
      const expected = {
        test: {
          local: 'Retained local edit',
          otherWindow: 'Saved in another window',
        },
      };
      expectYjsEqual(doc, expected);
      expectYjsEqual(otherDoc, expected);
      expectYjsEqual((await storage.getDoc(doc.guid))!.bin, expected);
    } finally {
      otherWindow.stop();
    }
  });

  test('does not acknowledge disconnected retained saves during writer recovery', async () => {
    frontend.start();
    const doc = connectDoc('recover-disconnected');
    await frontend.waitForUpdated();
    const error = new Error('Write failed');
    vi.spyOn(storage, 'pushDocUpdate').mockRejectedValueOnce(error);
    doc.getMap('test').set('text', 'Retained across disconnect');
    await expect(frontend.waitForUpdated()).rejects.toBe(error);
    doc.destroy();
    await expect(frontend.retryPersistence()).rejects.toThrow(
      'disconnected before local persistence'
    );
    await expect(frontend.waitForUpdated()).rejects.toThrow(
      'disconnected before local persistence'
    );
    const replacement = connectDoc(doc.guid);
    await frontend.waitForDocLoaded(replacement.guid);
    await frontend.retryPersistence();
    expectYjsEqual(replacement, {
      test: { text: 'Retained across disconnect' },
    });
    expectYjsEqual((await storage.getDoc(doc.guid))!.bin, {
      test: { text: 'Retained across disconnect' },
    });
    expect(persistenceState()).toMatchObject({ persistenceErrorMessage: null });
  });

  test('stopping during retry rejects new waiters and cannot restart the writer', async () => {
    frontend.start();
    const doc = connectDoc('stop-recovery');
    await frontend.waitForUpdated();
    const failedWrite = blockedWrite();
    doc.getMap('test').set('text', 'Pending recovery');
    const failed = expect(frontend.waitForUpdated()).rejects.toThrow(
      'Save failed'
    );
    await vi.waitFor(() => expect(failedWrite.push).toHaveBeenCalledOnce());
    failedWrite.reject(new Error('Save failed'));
    await failed;
    failedWrite.push.mockRestore();
    const write = blockedWrite();
    const retry = expect(frontend.retryPersistence()).rejects.toBe(
      MANUALLY_STOP
    );
    const waiter = expect(frontend.waitForUpdated()).rejects.toBe(
      MANUALLY_STOP
    );
    await vi.waitFor(() => expect(write.push).toHaveBeenCalledOnce());
    frontend.stop();
    await Promise.all([retry, waiter]);
    await expect(frontend.retryPersistence()).rejects.toBe(MANUALLY_STOP);
    expect(() => frontend.start()).toThrow('can only start once');
    write.release();
    await write.push.mock.results[0].value;
  });

  test('rechecks a rejected worker connection on retry', async () => {
    const error = new Error('Worker storage unavailable');
    const call = vi.fn(async (operation: string) => {
      if (operation === 'docStorage.waitForConnected') return;
      if (operation === 'docStorage.getDoc') return null;
      if (operation === 'docStorage.pushDocUpdate') {
        return { docId: 'worker-recovery', timestamp: new Date() };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    call.mockRejectedValueOnce(error);
    const client = new StoreClient({
      call,
      // eslint-disable-next-line rxjs/finnish -- Matches the OpClient transport API.
      ob$(operation: string) {
        if (operation === 'docSync.state') return DocSyncImpl.dummy.state$;
        throw new Error(`Unexpected observable ${operation}`);
      },
    } as never);
    frontend = client.docFrontend;
    const doc = connectDoc('worker-recovery');
    doc.getMap('test').set('text', 'Worker reconnection');
    frontend.start();
    await expect(frontend.waitForUpdated()).rejects.toBe(error);
    // Storage update subscription is independent of remote sync status.
    vi.spyOn(frontend.storage, 'subscribeDocUpdate').mockReturnValue(() => {});
    await frontend.retryPersistence();
    expect(
      call.mock.calls.filter(([op]) => op === 'docStorage.waitForConnected')
    ).toHaveLength(2);
    expect(persistenceState()).toMatchObject({
      updating: false,
      persistenceErrorMessage: null,
    });
  });

  test('does not fail global persistence on disconnect of an untouched queued load', async () => {
    const doc = connectDoc('untouched-load-doc');
    const loaded = expect(frontend.waitForDocLoaded(doc.guid)).rejects.toThrow(
      'disconnected before local persistence'
    );
    const globalWait = observeWait();
    doc.destroy();
    await loaded;
    await globalWait.settled;
    expect(globalWait.succeeded).toHaveBeenCalledOnce();
    expect(globalWait.failed).not.toHaveBeenCalled();
    await frontend.waitForUpdated();
  });

  test('rejects already-aborted callers before synchronous idle or loaded success', async () => {
    frontend.start();
    const doc = connectDoc('already-loaded-doc');
    await frontend.waitForUpdated(doc.guid);
    const abort = new AbortController();
    const error = new Error('Already cancelled');
    abort.abort(error);
    await expect(frontend.waitForUpdated(doc.guid, abort.signal)).rejects.toBe(
      error
    );
    await expect(frontend.waitForUpdated(undefined, abort.signal)).rejects.toBe(
      error
    );
    await expect(
      frontend.waitForDocLoaded(doc.guid, abort.signal)
    ).rejects.toBe(error);
    frontend.stop();
    await expect(frontend.waitForUpdated('untouched-doc')).rejects.toBe(
      MANUALLY_STOP
    );
    await expect(frontend.waitForDocLoaded(doc.guid)).rejects.toBe(
      MANUALLY_STOP
    );
  });
});
