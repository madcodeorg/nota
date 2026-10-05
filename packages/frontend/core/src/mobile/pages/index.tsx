import { DefaultServerService } from '@nota/core/modules/cloud';
import { WorkspacesService } from '@nota/core/modules/workspace';
import { createFirstAppData } from '@nota/core/utils/first-app-data';
import { ServerFeature } from '@nota/graphql';
import { useLiveData, useService } from '@nota/infra';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppFallback } from '../components/app-fallback';

export const Component = () => {
  const defaultServerService = useService(DefaultServerService);
  const workspacesService = useService(WorkspacesService);
  const navigate = useNavigate();

  const list = useLiveData(workspacesService.list.workspaces$);
  const listIsLoading = useLiveData(workspacesService.list.isRevalidating$);
  const enableLocalWorkspace =
    useLiveData(
      defaultServerService.server.config$.selector(
        c =>
          c.features.includes(ServerFeature.LocalWorkspace) ||
          BUILD_CONFIG.isNative
      )
    ) ?? true;

  const bootstrappingRef = useRef(false);

  useEffect(() => {
    if (listIsLoading || bootstrappingRef.current) {
      return;
    }

    if (!enableLocalWorkspace) {
      localStorage.removeItem('last_workspace_id');
      navigate('/sign-in', { replace: true });
      return;
    }

    const lastId = localStorage.getItem('last_workspace_id');
    const openWorkspace = list.find(w => w.id === lastId) ?? list[0];
    if (openWorkspace) {
      navigate(`/workspace/${openWorkspace.id}/home`, { replace: true });
      return;
    }

    bootstrappingRef.current = true;
    createFirstAppData(workspacesService)
      .then(createdWorkspace => {
        const workspaceId =
          createdWorkspace?.meta.id ??
          workspacesService.list.workspaces$.value[0]?.id;
        if (workspaceId) {
          navigate(`/workspace/${workspaceId}/home`, { replace: true });
        }
      })
      .catch(err => {
        localStorage.removeItem('is-first-open');
        console.error('Failed to create first app data', err);
      })
      .finally(() => {
        bootstrappingRef.current = false;
      });
  }, [enableLocalWorkspace, list, listIsLoading, navigate, workspacesService]);

  return <AppFallback />;
};
