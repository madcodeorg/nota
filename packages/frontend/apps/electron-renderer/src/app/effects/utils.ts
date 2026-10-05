import { ServersService } from '@nota/core/modules/cloud';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { GlobalContextService } from '@nota/core/modules/global-context';
import { WorkspacesService } from '@nota/core/modules/workspace';
import type { FrameworkProvider } from '@nota/infra';

export function getCurrentWorkspace(frameworkProvider: FrameworkProvider) {
  const currentWorkspaceId = frameworkProvider
    .get(GlobalContextService)
    .globalContext.workspaceId.get();
  const workspacesService = frameworkProvider.get(WorkspacesService);
  const workspaceRef = currentWorkspaceId
    ? workspacesService.openByWorkspaceId(currentWorkspaceId)
    : null;
  if (!workspaceRef) {
    return;
  }
  const { workspace, dispose } = workspaceRef;

  return {
    workspace,
    dispose,
    [Symbol.dispose]: dispose,
  };
}

export function getCurrentServerService(frameworkProvider: FrameworkProvider) {
  const currentServerId = frameworkProvider
    .get(GlobalContextService)
    .globalContext.serverId.get();
  const serversService = frameworkProvider.get(ServersService);
  const serverRef = currentServerId
    ? serversService.servers$.value.find(
        server => server.id === currentServerId
      )
    : null;
  return serverRef;
}

export function isAiEnabled(frameworkProvider: FrameworkProvider) {
  const featureFlagService = frameworkProvider.get(FeatureFlagService);
  const serverService = getCurrentServerService(frameworkProvider);
  const aiConfig = serverService?.features$.value.copilot;
  return featureFlagService.flags.enable_ai.$ && aiConfig;
}
