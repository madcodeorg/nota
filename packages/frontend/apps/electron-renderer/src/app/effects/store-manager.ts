import { NbstoreProvider } from '@nota/core/modules/storage';
import { apis } from '@nota/electron-api';
import type { Framework } from '@nota/infra';
import { OpClient } from '@nota/infra/op';
import { StoreManagerClient } from '@nota/nbstore/worker/client';
import { setTelemetryTransport } from '@nota/track';
import { v4 as uuid } from 'uuid';

function createStoreManagerClient() {
  const { port1: portForOpClient, port2: portForWorker } = new MessageChannel();
  let portFromWorker: MessagePort | null = null;
  let portId = uuid();

  const handleMessage = (ev: MessageEvent) => {
    if (
      ev.data.type === 'electron:worker-connect' &&
      ev.data.portId === portId
    ) {
      portFromWorker = ev.ports[0];
      // connect portForWorker and portFromWorker
      portFromWorker.addEventListener('message', ev => {
        portForWorker.postMessage(ev.data, [...ev.ports]);
      });
      portForWorker.addEventListener('message', ev => {
        // oxlint-disable-next-line no-non-null-assertion
        portFromWorker!.postMessage(ev.data, [...ev.ports]);
      });
      portForWorker.start();
      portFromWorker.start();
    }
  };

  window.addEventListener('message', handleMessage);

  // oxlint-disable-next-line no-non-null-assertion
  apis!.worker.connectWorker('nota-shared-worker', portId).catch(err => {
    console.error('failed to connect worker', err);
  });

  const storeManager = new StoreManagerClient(new OpClient(portForOpClient));
  portForOpClient.start();
  return storeManager;
}

export function setupStoreManager(framework: Framework) {
  const storeManagerClient = createStoreManagerClient();
  setTelemetryTransport(storeManagerClient.telemetry);
  window.addEventListener('beforeunload', () => {
    storeManagerClient.dispose();
  });
  window.addEventListener('focus', () => {
    storeManagerClient.resume();
  });
  window.addEventListener('click', () => {
    storeManagerClient.resume();
  });
  window.addEventListener('blur', () => {
    storeManagerClient.pause();
  });

  framework.impl(NbstoreProvider, {
    openStore(key, options) {
      const { store, dispose } = storeManagerClient.open(key, options);

      return {
        store,
        dispose: () => {
          dispose();
        },
      };
    },
  });
}
