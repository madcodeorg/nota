import '@nota/core/bootstrap/electron';

import { apis } from '@nota/electron-api';
import { OpConsumer } from '@nota/infra/op';
import { broadcastChannelStorages } from '@nota/nbstore/broadcast-channel';
import { cloudStorages } from '@nota/nbstore/cloud';
import { bindNativeDBApis, sqliteStorages } from '@nota/nbstore/sqlite';
import { bindNativeDBV1Apis, sqliteV1Storages } from '@nota/nbstore/sqlite/v1';
import {
  StoreManagerConsumer,
  type WorkerManagerOps,
} from '@nota/nbstore/worker/consumer';

// oxlint-disable-next-line no-non-null-assertion
bindNativeDBApis(apis!.nbstore);
// oxlint-disable-next-line no-non-null-assertion
bindNativeDBV1Apis(apis!.db);

const storeManager = new StoreManagerConsumer([
  ...sqliteStorages,
  ...sqliteV1Storages,
  ...broadcastChannelStorages,
  ...cloudStorages,
]);

window.addEventListener('message', ev => {
  if (ev.data.type === 'electron:worker-connect') {
    const port = ev.ports[0];

    const consumer = new OpConsumer<WorkerManagerOps>(port);
    storeManager.bindConsumer(consumer);
  }
});
