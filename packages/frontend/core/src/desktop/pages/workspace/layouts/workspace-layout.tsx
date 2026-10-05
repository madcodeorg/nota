import { uniReactRoot } from '@nota/component';
import { AiLoginRequiredModal } from '@nota/core/components/affine/auth/ai-login-required';
import { useResponsiveSidebar } from '@nota/core/components/hooks/use-responsive-siedebar';
import { SWRConfigProvider } from '@nota/core/components/providers/swr-config-provider';
import { WorkspaceSideEffects } from '@nota/core/components/providers/workspace-side-effects';
import { AIIsland } from '@nota/core/desktop/components/ai-island';
import { AppContainer } from '@nota/core/desktop/components/app-container';
import { DocumentTitle } from '@nota/core/desktop/components/document-title';
import { WorkspaceDialogs } from '@nota/core/desktop/dialogs';
import { PeekViewManagerModal } from '@nota/core/modules/peek-view';
import { QuotaCheck } from '@nota/core/modules/quota';
import { WorkbenchService } from '@nota/core/modules/workbench';
import {
  isServerBackedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { LiveData, useLiveData, useService } from '@nota/infra';
import type { PropsWithChildren } from 'react';

import { LocalBackupSideEffect } from '../local-backup-side-effect';
import { LocalPersistenceStatus } from '../local-persistence-status';
import { MeetingSaveSideEffect } from '../meetings/meeting-save-side-effect';

export const WorkspaceLayout = function WorkspaceLayout({
  children,
}: PropsWithChildren) {
  const currentWorkspace = useService(WorkspaceService).workspace;
  return (
    <SWRConfigProvider>
      <WorkspaceDialogs />

      {/* ---- some side-effect components ---- */}
      {isServerBackedWorkspaceFlavour(currentWorkspace.flavour) ? (
        <QuotaCheck workspaceMeta={currentWorkspace.meta} />
      ) : null}
      <AiLoginRequiredModal />
      <WorkspaceSideEffects />
      <MeetingSaveSideEffect />
      <LocalBackupSideEffect />
      <LocalPersistenceStatus />
      <PeekViewManagerModal />
      <DocumentTitle />

      <WorkspaceLayoutInner>{children}</WorkspaceLayoutInner>
      {/* should show after workspace loaded */}
      {/* FIXME: wait for better ai, <WorkspaceAIOnboarding /> */}
      <AIIsland />
      <uniReactRoot.Root />
    </SWRConfigProvider>
  );
};

/**
 * Wraps the workspace layout main router view
 */
const WorkspaceLayoutUIContainer = ({ children }: PropsWithChildren) => {
  const workbench = useService(WorkbenchService).workbench;
  const currentPath = useLiveData(
    LiveData.computed(get => {
      return get(workbench.basename$) + get(workbench.location$).pathname;
    })
  );
  useResponsiveSidebar();

  return (
    <AppContainer data-current-path={currentPath}>{children}</AppContainer>
  );
};
const WorkspaceLayoutInner = ({ children }: PropsWithChildren) => {
  return <WorkspaceLayoutUIContainer>{children}</WorkspaceLayoutUIContainer>;
};
