import { AffineErrorBoundary } from '@nota/core/components/affine/affine-error-boundary';
import { useService } from '@nota/infra';
import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { ViewService } from '../services/view';
import * as styles from './route-container.css';
import { ViewBodyTarget, ViewHeaderTarget } from './view-islands';

export interface Props {
  route: {
    Component: React.ComponentType;
  };
}

export const RouteContainer = () => {
  const view = useService(ViewService).view;

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
        <Suspense>
          <Outlet />
        </Suspense>
      </AffineErrorBoundary>
      <ViewBodyTarget viewId={view.id} className={styles.viewBodyContainer} />
    </div>
  );
};
