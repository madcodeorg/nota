import {
  beginLoopbackAuthFlow,
  cancelLoopbackAuthFlow,
  pollLoopbackAuthFlow,
} from '../auth/loopback-server';
import type { NamespaceHandlers } from '../type';
import { WebContentViewsManager } from '../windows-manager/tab-views';
import {
  clearSecureGoogleSession,
  readSecureGoogleSession,
  saveSecureGoogleSession,
} from './secure-session';
import { resolveSecureGoogleSession } from './session-refresh';
import { isTrustedGoogleSessionWorkbenchId } from './trusted-renderer';

function requireMainWorkspaceRenderer(event: Electron.IpcMainInvokeEvent) {
  const workbenchId =
    WebContentViewsManager.instance.getWorkbenchIdFromWebContentsId(
      event.sender.id
    );
  if (!isTrustedGoogleSessionWorkbenchId(workbenchId)) {
    throw new Error(
      'Google session access is restricted to the main workspace window.'
    );
  }
}

export const googleAuthHandlers = {
  beginLoopbackFlow: async event => {
    requireMainWorkspaceRenderer(event);
    return beginLoopbackAuthFlow();
  },
  cancelLoopbackFlow: async (event, flowId: string) => {
    requireMainWorkspaceRenderer(event);
    cancelLoopbackAuthFlow(flowId);
  },
  clearSession: async (event, mutationId?: string) => {
    requireMainWorkspaceRenderer(event);
    return clearSecureGoogleSession(mutationId);
  },
  getSession: async event => {
    requireMainWorkspaceRenderer(event);
    return readSecureGoogleSession();
  },
  pollLoopbackFlow: async (event, flowId: string) => {
    requireMainWorkspaceRenderer(event);
    return pollLoopbackAuthFlow(flowId);
  },
  refreshSession: async (event, mutationId?: string) => {
    requireMainWorkspaceRenderer(event);
    return resolveSecureGoogleSession(mutationId);
  },
  setSession: async (event, session: unknown, mutationId?: string) => {
    requireMainWorkspaceRenderer(event);
    return saveSecureGoogleSession(session, mutationId);
  },
} satisfies NamespaceHandlers;
