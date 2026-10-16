import { Loading } from '@nota/component';
import { AffineErrorBoundary } from '@nota/core/components/affine/affine-error-boundary';
import { useService, useServiceOptional } from '@nota/infra';
import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';

import { DesktopApiService } from '../../desktop-api';
import { ViewService } from '../services/view';
import * as styles from './route-container.css';
import { ViewBodyTarget, ViewHeaderTarget } from './view-islands';

export interface Props {
  route: {
    Component: React.ComponentType;
  };
}

const READY_FALLBACK_TIMEOUT = 3000;

// Tells the main process this tab has real content so it can drop the shell
// view that covers it. Idempotent.
const useAppLayoutReady = () => {
  const desktopApi = useServiceOptional(DesktopApiService);
  const pinged = useRef(false);

  return useCallback(() => {
    if (pinged.current || !BUILD_CONFIG.isElectron) return;
    pinged.current = true;
    desktopApi?.handler.ui.pingAppLayoutReady().catch(console.error);
  }, [desktopApi]);
};

// Rendered inside <Suspense>: React does not commit it until the lazy route
// has resolved. The double frame lets the view islands register first.
const ReadyBeacon = ({ onReady }: { onReady: () => void }) => {
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(onReady);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [onReady]);

  return null;
};

export const RouteContainer = () => {
  const view = useService(ViewService).view;
  const pingReady = useAppLayoutReady();

  // A route that fails or loads slowly must not leave the tab hidden.
  useEffect(() => {
    const timer = setTimeout(pingReady, READY_FALLBACK_TIMEOUT);
    return () => clearTimeout(timer);
  }, [pingReady]);

  return (
    <div className={styles.root}>
      {/* The always-visible sidebar rail owns the sidebar toggle. */}
      <div className={styles.header}>
        <ViewHeaderTarget
          viewId={view.id}
          className={styles.viewHeaderContainer}
        />
      </div>

      <AffineErrorBoundary>
        <Suspense
          fallback={
            <div className={styles.routeFallback}>
              <Loading size={24} />
            </div>
          }
        >
          <Outlet />
          <ReadyBeacon onReady={pingReady} />
        </Suspense>
      </AffineErrorBoundary>
      <ViewBodyTarget viewId={view.id} className={styles.viewBodyContainer} />
    </div>
  );
};
