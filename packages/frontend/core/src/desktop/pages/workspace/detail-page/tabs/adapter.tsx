import { AdapterPanel } from '@blocksuite/affine/fragments/adapter-panel';
import {
  docLinkBaseURLMiddlewareBuilder,
  embedSyncedDocMiddleware,
  titleMiddleware,
} from '@blocksuite/affine/shared/adapters';
import type { EditorHost } from '@blocksuite/affine/std';
import type { TransformerMiddleware } from '@blocksuite/affine/store';
import { ServerService } from '@nota/core/modules/cloud';
import { useService } from '@nota/infra';
import { useCallback, useEffect, useRef } from 'react';

import * as styles from './adapter.css';

const createMiddlewares = (
  host: EditorHost,
  baseUrl: string
): TransformerMiddleware[] => {
  return [
    docLinkBaseURLMiddlewareBuilder(baseUrl, host.store.workspace.id).get(),
    titleMiddleware(host.store.workspace.meta.docMetas),
    embedSyncedDocMiddleware('content'),
  ];
};

const getTransformerMiddlewares = (
  host: EditorHost | null,
  baseUrl: string
) => {
  if (!host) return [];
  return createMiddlewares(host, baseUrl);
};

// A wrapper for AdapterPanel
export const EditorAdapterPanel = ({ host }: { host: EditorHost | null }) => {
  const server = useService(ServerService).server;
  const adapterPanelRef = useRef<AdapterPanel | null>(null);

  const onRefChange = useCallback(
    (container: HTMLDivElement | null) => {
      if (container && host && container.children.length === 0) {
        adapterPanelRef.current = new AdapterPanel();
        adapterPanelRef.current.store = host.store;
        adapterPanelRef.current.transformerMiddlewares =
          getTransformerMiddlewares(host, server.baseUrl);
        container.append(adapterPanelRef.current);
      }
    },
    [host, server]
  );

  useEffect(() => {
    if (host && adapterPanelRef.current) {
      adapterPanelRef.current.store = host.store;
      adapterPanelRef.current.transformerMiddlewares =
        getTransformerMiddlewares(host, server.baseUrl);
    }
  }, [host, server]);

  return <div className={styles.root} ref={onRefChange} />;
};
