import { onboardingViewUrl } from '../../shared/internal-origin';
import {
  beginLoopbackAuthFlow,
  cancelLoopbackAuthFlow,
  pollLoopbackAuthFlow,
} from '../auth/loopback-server';
import type { NamespaceHandlers } from '../type';
import { getOnboardingWindow } from '../windows-manager/onboarding';
import { WebContentViewsManager } from '../windows-manager/tab-views';
import {
  clearSecureGoogleSession,
  readSecureGoogleSession,
  saveSecureGoogleSession,
} from './secure-session';
import { resolveSecureGoogleSession } from './session-refresh';
import {
  isTrustedGoogleSessionWorkbenchId,
  isTrustedOnboardingRenderer,
} from './trusted-renderer';

// Workspace views and the first-launch window (its "Sync with Google Drive"
// step) may use the Google session; no other renderer can.
async function requireMainWorkspaceRenderer(
  event: Electron.IpcMainInvokeEvent
) {
  const workbenchId =
    WebContentViewsManager.instance.getWorkbenchIdFromWebContentsId(
      event.sender.id
    );
  if (isTrustedGoogleSessionWorkbenchId(workbenchId)) return;
  const onboarding = await getOnboardingWindow();
  // Only the onboarding page's own top frame, never a child frame.
  if (
    event.senderFrame === event.sender.mainFrame &&
    isTrustedOnboardingRenderer(
      event.sender.id,
      event.senderFrame?.url ?? '',
      onboarding?.webContents.id,
      onboardingViewUrl
    )
  ) {
    return;
  }
  throw new Error(
    'Google session access is restricted to the main workspace window.'
  );
}

export const googleAuthHandlers = {
  beginLoopbackFlow: async event => {
    await requireMainWorkspaceRenderer(event);
    return beginLoopbackAuthFlow();
  },
  cancelLoopbackFlow: async (event, flowId: string) => {
    await requireMainWorkspaceRenderer(event);
    cancelLoopbackAuthFlow(flowId);
  },
  clearSession: async (event, mutationId?: string) => {
    await requireMainWorkspaceRenderer(event);
    return clearSecureGoogleSession(mutationId);
  },
  getSession: async event => {
    await requireMainWorkspaceRenderer(event);
    return readSecureGoogleSession();
  },
  pollLoopbackFlow: async (event, flowId: string) => {
    await requireMainWorkspaceRenderer(event);
    return pollLoopbackAuthFlow(flowId);
  },
  refreshSession: async (event, mutationId?: string) => {
    await requireMainWorkspaceRenderer(event);
    return resolveSecureGoogleSession(mutationId);
  },
  setSession: async (event, session: unknown, mutationId?: string) => {
    await requireMainWorkspaceRenderer(event);
    return saveSecureGoogleSession(session, mutationId);
  },
} satisfies NamespaceHandlers;
