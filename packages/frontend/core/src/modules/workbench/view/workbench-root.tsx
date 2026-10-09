import { AffineErrorComponent } from '@nota/core/components/affine/affine-error-boundary/affine-error-fallback';
import { pagePanelSlot$ } from '@nota/core/components/root-app-sidebar/ai-panel-slot';
import { workbenchRoutes } from '@nota/core/desktop/workbench-router';
import { FrameworkScope, useLiveData, useService } from '@nota/infra';
import { memo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type RouteObject, useLocation } from 'react-router-dom';

import type { View } from '../entities/view';
import { WorkbenchService } from '../services/workbench';
import { useBindWorkbenchToBrowserRouter } from './browser-adapter';
import { useBindWorkbenchToDesktopRouter } from './desktop-adapter';
import { RouteContainer } from './route-container';
import { SidebarContainer } from './sidebar/sidebar-container';
import { SplitView } from './split-view/split-view';
import { ViewIslandRegistryProvider } from './view-islands';
import { ViewRoot } from './view-root';
import * as styles from './workbench-root.css';

const useAdapter = BUILD_CONFIG.isElectron
  ? useBindWorkbenchToDesktopRouter
  : useBindWorkbenchToBrowserRouter;

const routes: RouteObject[] = [
  {
    element: <RouteContainer />,
    errorElement: <AffineErrorComponent />,
    children: workbenchRoutes,
  },
];

export const WorkbenchRoot = memo(() => {
  const workbench = useService(WorkbenchService).workbench;

  // for debugging
  (window as any).workbench = workbench;

  const views = useLiveData(workbench.views$);

  const location = useLocation();
  const basename = location.pathname.match(/\/workspace\/[^/]+/g)?.[0] ?? '/';

  useAdapter(workbench, basename);

  const panelRenderer = useCallback((view: View) => {
    return <WorkbenchView view={view} />;
  }, []);

  const onMove = useCallback(
    (from: number, to: number) => {
      workbench.moveView(from, to);
    },
    [workbench]
  );

  useEffect(() => {
    workbench.updateBasename(basename);
  }, [basename, workbench]);

  return (
    <ViewIslandRegistryProvider>
      <SplitView
        className={styles.workbenchRootContainer}
        views={views}
        renderer={panelRenderer}
        onMove={onMove}
      />
      <PagePanelPortal />
    </ViewIslandRegistryProvider>
  );
});

WorkbenchRoot.displayName = 'memo(WorkbenchRoot)';

// Renders the active view's page panels into the left sidebar's Page section.
const PagePanelPortal = () => {
  const workbench = useService(WorkbenchService).workbench;
  const activeView = useLiveData(workbench.activeView$);
  const slot = useLiveData(pagePanelSlot$);
  if (!slot) return null;
  return createPortal(
    <FrameworkScope scope={activeView.scope}>
      <SidebarContainer style={{ height: '100%' }} />
    </FrameworkScope>,
    slot
  );
};

const WorkbenchView = ({ view }: { view: View }) => {
  const workbench = useService(WorkbenchService).workbench;

  const handleOnFocus = useCallback(() => {
    workbench.active(view);
  }, [workbench, view]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      const element = containerRef.current;
      element.addEventListener('pointerdown', handleOnFocus, {
        capture: true,
      });
      return () => {
        element.removeEventListener('pointerdown', handleOnFocus, {
          capture: true,
        });
      };
    }
    return;
  }, [handleOnFocus]);

  return (
    <div className={styles.workbenchViewContainer} ref={containerRef}>
      <ViewRoot routes={routes} key={view.id} view={view} />
    </div>
  );
};
