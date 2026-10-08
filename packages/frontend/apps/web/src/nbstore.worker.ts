import '@nota/core/bootstrap/browser';

import { type MessageCommunicapable, OpConsumer } from '@nota/infra/op';
import { broadcastChannelStorages } from '@nota/nbstore/broadcast-channel';
import { cloudStorages } from '@nota/nbstore/cloud';
import { googleDriveStorages } from '@nota/nbstore/google-drive';
import { idbStorages } from '@nota/nbstore/idb';
import { idbV1Storages } from '@nota/nbstore/idb/v1';
import {
  StoreManagerConsumer,
  type WorkerManagerOps,
} from '@nota/nbstore/worker/consumer';

const consumer = new StoreManagerConsumer([
  ...idbStorages,
  ...idbV1Storages,
  ...broadcastChannelStorages,
  ...cloudStorages,
  ...googleDriveStorages,
]);

if ('onconnect' in globalThis) {
  // if in shared worker

  (globalThis as any).onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    consumer.bindConsumer(new OpConsumer<WorkerManagerOps>(port));
  };
} else {
  // if in worker
  consumer.bindConsumer(
    new OpConsumer<WorkerManagerOps>(globalThis as MessageCommunicapable)
  );
}
