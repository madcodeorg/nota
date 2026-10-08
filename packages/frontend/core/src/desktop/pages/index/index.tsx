import { DefaultServerService } from '@nota/core/modules/cloud';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { WorkspacesService } from '@nota/core/modules/workspace';
import {
  buildShowcaseWorkspace,
  createFirstAppData,
  isFirstAppOpen,
} from '@nota/core/utils/first-app-data';
import { ServerFeature } from '@nota/graphql';
import { useLiveData, useService, useServiceOptional } from '@nota/infra';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';
import { WorkspaceNavigator } from '../../../components/workspace-selector';
import { AuthService } from '../../../modules/cloud';
import { AppContainer } from '../../components/app-container';

/**
 * index page
 *
 * query string:
 * - initCloud: boolean, if true, when user is logged in, create a cloud workspace
 */
export const Component = ({
  defaultIndexRoute = 'all',
  children,
  fallback,
}: {
  defaultIndexRoute?: string;
  children?: ReactNode;
  fallback?: ReactNode;
}) => {
  // navigating and creating may be slow, to avoid flickering, we show workspace fallback
  const [navigating, setNavigating] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState(false);
  const [creationAttempt, setCreationAttempt] = useState(0);
  const createLocalOnceRef = useRef(false);
  const authService = useService(AuthService);
  const defaultServerService = useService(DefaultServerService);

  const loggedIn = useLiveData(
    authService.session.status$.map(s => s === 'authenticated')
  );
  const enableLocalWorkspace =
    useLiveData(
      defaultServerService.server.config$.selector(
        c =>
          c.features.includes(ServerFeature.LocalWorkspace) ||
          BUILD_CONFIG.isNative
      )
    ) ?? true;

  const workspacesService = useService(WorkspacesService);
  const list = useLiveData(workspacesService.list.workspaces$);
  const listIsLoading = useLiveData(workspacesService.list.isRevalidating$);

  const { openPage, jumpToPage, jumpToSignIn } = useNavigateHelper();
  const [searchParams] = useSearchParams();

  const createOnceRef = useRef(false);

  const createCloudWorkspace = useCallback(() => {
    if (createOnceRef.current) return;
    createOnceRef.current = true;
    // TODO: support selfhosted
    buildShowcaseWorkspace(workspacesService, 'nota-cloud', 'Nota Cloud')
      .then(({ meta, defaultDocId }) => {
        if (defaultDocId) {
          jumpToPage(meta.id, defaultDocId);
        } else {
          openPage(meta.id, defaultIndexRoute);
        }
      })
      .catch(err => console.error('Failed to create cloud workspace', err));
  }, [defaultIndexRoute, jumpToPage, openPage, workspacesService]);

  useLayoutEffect(() => {
    if (!navigating) {
      return;
    }

    if (listIsLoading) {
      return;
    }

    if (!enableLocalWorkspace && !loggedIn) {
      try {
        localStorage.removeItem('last_workspace_id');
      } catch {
        // The sign-in route does not depend on optional local preferences.
      }
      jumpToSignIn();
      return;
    }

    // check is user logged in && has cloud workspace
    if (searchParams.get('initCloud') === 'true') {
      if (loggedIn) {
        if (list.every(w => w.flavour !== 'nota-cloud')) {
          createCloudWorkspace();
          return;
        }

        // open first cloud workspace
        const openWorkspace =
          list.find(w => w.flavour === 'nota-cloud') ?? list[0];
        openPage(openWorkspace.id, defaultIndexRoute);
      } else {
        return;
      }
    } else {
      if (list.length === 0) {
        setNavigating(false);
        return;
      }
      // open last workspace
      let lastId: string | null = null;
      try {
        lastId = localStorage.getItem('last_workspace_id');
      } catch {
        // Use the first saved workspace when preferences are unavailable.
      }

      const openWorkspace = list.find(w => w.id === lastId) ?? list[0];
      openPage(openWorkspace.id, defaultIndexRoute, RouteLogic.REPLACE);
    }
  }, [
    enableLocalWorkspace,
    createCloudWorkspace,
    list,
    openPage,
    searchParams,
    jumpToSignIn,
    listIsLoading,
    loggedIn,
    navigating,
    defaultIndexRoute,
  ]);

  const desktopApi = useServiceOptional(DesktopApiService);
  const needsFirstWorkspace =
    enableLocalWorkspace && list.length === 0 && isFirstAppOpen();

  useEffect(() => {
    if (
      !navigating &&
      !creating &&
      !listIsLoading &&
      !needsFirstWorkspace &&
      !creationError
    ) {
      desktopApi?.handler.ui.pingAppLayoutReady().catch(console.error);
    }
  }, [
    desktopApi,
    navigating,
    creating,
    listIsLoading,
    needsFirstWorkspace,
    creationError,
  ]);

  useEffect(() => {
    if (listIsLoading || !needsFirstWorkspace || createLocalOnceRef.current) {
      return;
    }

    createLocalOnceRef.current = true;
    setCreating(true);
    setCreationError(false);
    createFirstAppData(workspacesService)
      .then(createdWorkspace => {
        if (!createdWorkspace) {
          setCreating(false);
          return;
        }
        // The workspace route loads lazily. Keep the loading fallback until the
        // router leaves this page instead of briefly mounting the selector.
        if (createdWorkspace.defaultPageId) {
          jumpToPage(createdWorkspace.meta.id, createdWorkspace.defaultPageId);
        } else {
          openPage(createdWorkspace.meta.id, 'all');
        }
      })
      .catch(err => {
        setCreationError(true);
        setCreating(false);
        console.error('Failed to create first app data', err);
      });
  }, [
    jumpToPage,
    jumpToSignIn,
    openPage,
    workspacesService,
    loggedIn,
    listIsLoading,
    list,
    needsFirstWorkspace,
    creationAttempt,
  ]);

  if (creationError) {
    return (
      <AppContainer fallback>
        <div role="alert" style={{ padding: 32 }}>
          <p>Nota couldn’t finish creating your local workspace. Try again.</p>
          <button
            type="button"
            onClick={() => {
              createLocalOnceRef.current = false;
              setCreationError(false);
              setCreationAttempt(attempt => attempt + 1);
            }}
          >
            Try again
          </button>
        </div>
      </AppContainer>
    );
  }

  if (navigating || creating || listIsLoading || needsFirstWorkspace) {
    return fallback ?? <AppContainer fallback />;
  }

  // TODO(@eyhn): We need a no workspace page
  return (
    children ?? (
      <div
        style={{
          position: 'fixed',
          left: 'calc(50% - 150px)',
          top: '50%',
        }}
      >
        <WorkspaceNavigator
          open={true}
          menuContentOptions={{
            forceMount: true,
          }}
        />
      </div>
    )
  );
};
