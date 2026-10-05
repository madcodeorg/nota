import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { BlockStdScope } from '@blocksuite/affine/std';
import type { Workspace } from '@blocksuite/affine/store';
import { observeResize, useConfirmModal } from '@nota/component';
import { CopilotClient } from '@nota/core/blocksuite/ai';
import { type AgentActionProposal } from '@nota/core/blocksuite/ai/agent';
import {
  AIChatContent,
  type ChatContextValue,
} from '@nota/core/blocksuite/ai/components/ai-chat-content';
import type { ChatStatus } from '@nota/core/blocksuite/ai/components/ai-chat-messages';
import type { AIChatToolbar } from '@nota/core/blocksuite/ai/components/ai-chat-toolbar';
import {
  configureAIChatToolbar,
  getOrCreateAIChatToolbar,
} from '@nota/core/blocksuite/ai/components/ai-chat-toolbar';
import type { PromptKey } from '@nota/core/blocksuite/ai/provider/prompt';
import { getViewManager } from '@nota/core/blocksuite/manager/view';
import { NotificationServiceImpl } from '@nota/core/blocksuite/view-extensions/editor-view/notification-service';
import { useAIChatConfig } from '@nota/core/components/hooks/nota/use-ai-chat-config';
import { useAISpecs } from '@nota/core/components/hooks/nota/use-ai-specs';
import {
  AIDraftService,
  AIToolsConfigService,
} from '@nota/core/modules/ai-button';
import { AIModelService } from '@nota/core/modules/ai-button/services/models';
import { EventSourceService, GraphQLService } from '@nota/core/modules/cloud';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import { EditorService } from '@nota/core/modules/editor';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { PeekViewService } from '@nota/core/modules/peek-view';
import { GuardService } from '@nota/core/modules/permissions';
import { AppThemeService } from '@nota/core/modules/theme';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewService,
  ViewTitle,
  WorkbenchService,
} from '@nota/core/modules/workbench';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useFramework, useService } from '@nota/infra';
import { type Signal, signal } from '@preact/signals-core';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type { WorkspaceContentAccessForDocument } from '../ai-workspace-index';
import { createSessionDeleteHandler } from '../chat-panel-utils';
import { useActionProposalHandlers } from '../use-action-proposal-handlers';
import * as styles from './index.css';

type CopilotSession = Awaited<ReturnType<CopilotClient['getSession']>>;
function useCopilotClient() {
  const graphqlService = useService(GraphQLService);
  const eventSourceService = useService(EventSourceService);

  return useMemo(
    () => new CopilotClient(graphqlService.gql, eventSourceService.eventSource),
    [graphqlService, eventSourceService]
  );
}

function createMockStd(workspace: Workspace) {
  workspace.meta.initialize();
  // just pick a random doc for now
  const store = workspace.docs.values().next().value?.getStore();
  if (!store) return null;
  const std = new BlockStdScope({
    store,
    extensions: [...getViewManager().config.init().value.get('page')],
  });
  std.render();
  return std;
}

function useMockStd() {
  const workspace = useService(WorkspaceService).workspace;
  const std = useMemo(() => {
    if (!workspace) return null;
    return createMockStd(workspace.docCollection);
  }, [workspace]);
  return std;
}

function activeEditorContainerForSelection(
  framework: ReturnType<typeof useFramework>,
  proposal: Extract<
    AgentActionProposal,
    { type: 'insert_markdown' | 'replace_selection' }
  >
) {
  const editorContainer =
    framework.getOptional(EditorService)?.editor.editorContainer$.value ?? null;
  if (!editorContainer?.host || editorContainer.doc.id !== proposal.docId) {
    return null;
  }
  return editorContainer;
}

export const Component = () => {
  const t = useI18n();
  const framework = useFramework();
  const [isBodyProvided, setIsBodyProvided] = useState(false);
  const [isHeaderProvided, setIsHeaderProvided] = useState(false);
  const [chatContent, setChatContent] = useState<AIChatContent | null>(null);
  const [chatTool, setChatTool] = useState<AIChatToolbar | null>(null);
  const [currentSession, setCurrentSession] = useState<CopilotSession | null>(
    null
  );
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [isTogglingPin, setIsTogglingPin] = useState(false);
  const [isOpeningSession, setIsOpeningSession] = useState(false);
  const hasRestoredPinnedSessionRef = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatToolContainerRef = useRef<HTMLDivElement>(null);
  const widthSignalRef = useRef<Signal<number>>(signal(0));
  const client = useCopilotClient();
  const workbench = useService(WorkbenchService).workbench;
  const location = useLocation();

  const workspaceId = useService(WorkspaceService).workspace.id;
  const workspaceService = useService(WorkspaceService);
  const docsService = useService(DocsService);
  const requestedSessionId = useMemo(
    () => new URLSearchParams(location.search).get('sessionId'),
    [location.search]
  );
  const accessForWorkspaceDocument =
    useCallback<WorkspaceContentAccessForDocument>(
      async ({ docId }) => {
        if (isUserOwnedWorkspaceFlavour(workspaceService.workspace.flavour)) {
          return { readable: true, visibility: 'workspace' };
        }
        const guardService = framework.getOptional(GuardService);
        if (!guardService) {
          return { readable: false, visibility: 'workspace' };
        }
        try {
          return {
            readable: await guardService.can('Doc_Read', docId),
            visibility: 'workspace',
          };
        } catch (error) {
          console.warn(
            'Failed to check doc read permission for AI index',
            error
          );
          return { readable: false, visibility: 'workspace' };
        }
      },
      [framework, workspaceService.workspace.flavour]
    );

  useEffect(() => {
    hasRestoredPinnedSessionRef.current = false;
  }, [workspaceId]);

  const { docDisplayConfig, searchMenuConfig, reasoningConfig } =
    useAIChatConfig();

  const createSession = useCallback(
    async (options: Partial<BlockSuitePresets.AICreateSessionOptions> = {}) => {
      if (currentSession) {
        return currentSession;
      }
      const session = await client.createSessionWithHistory({
        workspaceId,
        promptName: 'Chat With Nota AI' satisfies PromptKey,
        reuseLatestChat: true,
        ...options,
      });
      setCurrentSession(session);
      return session;
    },
    [client, currentSession, workspaceId]
  );

  const togglePin = useCallback(async () => {
    if (isTogglingPin) return;
    setIsTogglingPin(true);
    try {
      const pinned = !currentSession?.pinned;
      if (!currentSession) {
        await createSession({ pinned });
      } else {
        await client.updateSession({
          sessionId: currentSession.sessionId,
          pinned,
        });
        // retrieve the latest session and update the state
        const session = await client.getSession(
          workspaceId,
          currentSession.sessionId
        );
        setCurrentSession(session);
      }
    } finally {
      setIsTogglingPin(false);
    }
  }, [client, createSession, currentSession, isTogglingPin, workspaceId]);

  // remove the old content to trigger re-mount
  // to avoid infinitely load and mount, should not make `chatContent` as dependency
  const reMountChatContent = useCallback(() => {
    setChatContent(prev => {
      prev?.remove();
      return null;
    });
  }, []);

  const createFreshSession = useCallback(async () => {
    if (isOpeningSession) {
      return;
    }
    setIsOpeningSession(true);
    try {
      setCurrentSession(null);
      reMountChatContent();
      const session = await client.createSessionWithHistory({
        workspaceId,
        promptName: 'Chat With Nota AI' satisfies PromptKey,
        reuseLatestChat: false,
      });
      setCurrentSession(session);
    } catch (error) {
      console.error(error);
    } finally {
      setIsOpeningSession(false);
    }
  }, [client, isOpeningSession, reMountChatContent, workspaceId]);

  const onOpenSession = useCallback(
    async (sessionId: string) => {
      if (isOpeningSession || currentSession?.sessionId === sessionId) return;
      setIsOpeningSession(true);
      try {
        const session = await client.getSession(workspaceId, sessionId);
        setCurrentSession(session);
        reMountChatContent();
        chatTool?.closeHistoryMenu();
      } catch (error) {
        console.error(error);
      } finally {
        setIsOpeningSession(false);
      }
    },
    [
      chatTool,
      client,
      currentSession?.sessionId,
      isOpeningSession,
      reMountChatContent,
      workspaceId,
    ]
  );

  useEffect(() => {
    if (
      !requestedSessionId ||
      isOpeningSession ||
      currentSession?.sessionId === requestedSessionId
    ) {
      return;
    }

    let disposed = false;
    setIsOpeningSession(true);
    client
      .getSession(workspaceId, requestedSessionId)
      .then(session => {
        if (disposed || !session) {
          return;
        }
        hasRestoredPinnedSessionRef.current = true;
        setCurrentSession(session);
        reMountChatContent();
      })
      .catch(console.error)
      .finally(() => {
        if (!disposed) {
          setIsOpeningSession(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [
    client,
    currentSession?.sessionId,
    isOpeningSession,
    reMountChatContent,
    requestedSessionId,
    workspaceId,
  ]);

  const onContextChange = useCallback((context: Partial<ChatContextValue>) => {
    setStatus(context.status ?? 'idle');
  }, []);

  const onOpenDoc = useCallback(
    (docId: string) => {
      workbench.openDoc(docId, { at: 'active' });
    },
    [workbench]
  );
  const mockStd = useMockStd();
  const getSelectionEditorContainer = useCallback(
    (
      proposal: Extract<
        AgentActionProposal,
        { type: 'insert_markdown' | 'replace_selection' }
      >
    ) => activeEditorContainerForSelection(framework, proposal),
    [framework]
  );
  const {
    applyingProposalId,
    applyActionProposal,
    rejectActionProposal,
    undoActionProposal,
  } = useActionProposalHandlers({
    accessForDocument: accessForWorkspaceDocument,
    docsService,
    getSelectionEditorContainer,
    guardService: framework.getOptional(GuardService),
    isLocalWorkspace: isUserOwnedWorkspaceFlavour(
      workspaceService.workspace.flavour
    ),
    mindmapProvider: mockStd?.store.provider,
    onOpenDoc,
    sessionId: currentSession?.sessionId,
    workspace: workspaceService.workspace.docCollection,
    workspaceId,
  });
  const onOpenSessionDoc = useCallback(
    (docId: string, sessionId: string) => {
      const { workbench } = framework.get(WorkbenchService);
      const viewService = framework.get(ViewService);
      workbench.open(`/${docId}?sessionId=${sessionId}`, { at: 'active' });
      workbench.openSidebar();
      viewService.view.activeSidebarTab('chat');
    },
    [framework]
  );

  const confirmModal = useConfirmModal();
  const notificationService = useMemo(
    () =>
      new NotificationServiceImpl(
        confirmModal.closeConfirmModal,
        confirmModal.openConfirmModal
      ),
    [confirmModal.closeConfirmModal, confirmModal.openConfirmModal]
  );
  const specs = useAISpecs();
  const deleteSession = useMemo(
    () =>
      createSessionDeleteHandler({
        t,
        notificationService,
        cleanupSession: async sessionToDelete => {
          await client.cleanupSessions({
            workspaceId: sessionToDelete.workspaceId,
            docId: sessionToDelete.docId || undefined,
            sessionIds: [sessionToDelete.sessionId],
          });
        },
        isActiveSession: sessionToDelete =>
          sessionToDelete.sessionId === currentSession?.sessionId,
        onActiveSessionDeleted: () => {
          setCurrentSession(null);
          reMountChatContent();
        },
      }),
    [
      client,
      currentSession?.sessionId,
      notificationService,
      reMountChatContent,
      t,
    ]
  );

  // init or update ai-chat-content
  useEffect(() => {
    if (!isBodyProvided) {
      return;
    }

    let content = chatContent;

    if (!content) {
      content = new AIChatContent();
    }

    content.session = currentSession;
    content.workspaceId = workspaceId;
    content.extensions = specs;
    content.host = mockStd?.host;
    content.docDisplayConfig = docDisplayConfig;
    content.searchMenuConfig = searchMenuConfig;
    content.reasoningConfig = reasoningConfig;
    content.onContextChange = onContextChange;
    content.affineFeatureFlagService = framework.get(FeatureFlagService);
    content.affineWorkspaceDialogService = framework.get(
      WorkspaceDialogService
    );
    content.peekViewService = framework.get(PeekViewService);
    content.affineThemeService = framework.get(AppThemeService);
    content.notificationService = notificationService;
    content.aiDraftService = framework.get(AIDraftService);
    content.aiToolsConfigService = framework.get(AIToolsConfigService);
    content.aiModelService = framework.get(AIModelService);

    content.createSession = createSession;
    content.onOpenDoc = onOpenDoc;
    content.applyingProposalId = applyingProposalId;
    content.onApplyActionProposal = applyActionProposal;
    content.onRejectActionProposal = rejectActionProposal;
    content.onUndoActionProposal = undoActionProposal;

    if (!chatContent) {
      // initial values that won't change
      content.independentMode = true;
      content.onboardingOffsetY = -100;
      chatContainerRef.current?.append(content);
      setChatContent(content);
    }
  }, [
    chatContent,
    createSession,
    currentSession,
    docDisplayConfig,
    framework,
    isBodyProvided,
    mockStd,
    reasoningConfig,
    searchMenuConfig,
    workspaceId,
    onContextChange,
    notificationService,
    specs,
    onOpenDoc,
    applyingProposalId,
    applyActionProposal,
    rejectActionProposal,
    undoActionProposal,
  ]);

  // init or update header ai-chat-toolbar
  useEffect(() => {
    if (!isHeaderProvided || !chatToolContainerRef.current) {
      return;
    }
    const tool = getOrCreateAIChatToolbar(chatTool);
    configureAIChatToolbar(tool, {
      session: currentSession,
      workspaceId,
      status,
      docDisplayConfig,
      notificationService,
      onOpenSession: sessionId => {
        onOpenSession(sessionId).catch(console.error);
      },
      onNewSession: () => {
        createFreshSession().catch(console.error);
      },
      onTogglePin: togglePin,
      onOpenDoc: (docId: string, sessionId: string) => {
        onOpenSessionDoc(docId, sessionId);
      },
      onSessionDelete: (sessionToDelete: BlockSuitePresets.AIRecentSession) => {
        deleteSession(sessionToDelete).catch(console.error);
      },
    });

    // initial props
    if (!chatTool) {
      // mount
      chatToolContainerRef.current.append(tool);
      setChatTool(tool);
    }
  }, [
    chatTool,
    currentSession,
    docDisplayConfig,
    isHeaderProvided,
    onOpenSession,
    togglePin,
    workspaceId,
    onOpenSessionDoc,
    deleteSession,
    status,
    notificationService,
    createFreshSession,
  ]);

  useEffect(() => {
    const refNodeSlots = mockStd?.getOptional(RefNodeSlotsProvider);
    if (!refNodeSlots) return;
    const sub = refNodeSlots.docLinkClicked.subscribe(event => {
      const { workbench } = framework.get(WorkbenchService);
      workbench.openDoc({
        docId: event.pageId,
        mode: event.params?.mode,
        blockIds: event.params?.blockIds,
        elementIds: event.params?.elementIds,
        refreshKey: nanoid(),
      });
    });
    return () => sub.unsubscribe();
  }, [framework, mockStd]);

  // restore pinned session
  useEffect(() => {
    if (requestedSessionId) return;
    if (hasRestoredPinnedSessionRef.current || currentSession) return;
    hasRestoredPinnedSessionRef.current = true;

    const controller = new AbortController();
    const loadPinnedSession = async () => {
      try {
        const sessions = await client.getSessions(
          workspaceId,
          {},
          undefined,
          { pinned: true, limit: 1 },
          controller.signal
        );
        if (controller.signal.aborted || !Array.isArray(sessions)) {
          return;
        }
        const pinnedSession = sessions[0];
        if (!pinnedSession) {
          return;
        }

        let shouldRemount = false;
        setCurrentSession(prev => {
          if (prev) return prev;
          shouldRemount = true;
          return pinnedSession;
        });
        if (shouldRemount) reMountChatContent();
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error(error);
      }
    };
    loadPinnedSession().catch(error => {
      if (controller.signal.aborted) return;
      console.error(error);
    });

    // abort the request
    return () => {
      controller.abort();
    };
  }, [
    client,
    currentSession,
    reMountChatContent,
    requestedSessionId,
    workspaceId,
  ]);

  const onChatContainerRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      setIsBodyProvided(true);
      chatContainerRef.current = node;
      widthSignalRef.current.value = node.clientWidth;
    }
  }, []);

  const onChatToolContainerRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      setIsHeaderProvided(true);
      chatToolContainerRef.current = node;
    }
  }, []);

  // observe chat container width and provide to ai-chat-content
  useEffect(() => {
    if (!isBodyProvided || !chatContainerRef.current) return;
    return observeResize(chatContainerRef.current, entry => {
      widthSignalRef.current.value = entry.contentRect.width;
    });
  }, [isBodyProvided]);

  return (
    <>
      <ViewTitle title={t['com.affine.workspaceSubPath.chat']()} />
      <ViewIcon icon="ai" />
      <ViewHeader>
        <div className={styles.chatHeader}>
          <div />
          <div ref={onChatToolContainerRef} />
        </div>
      </ViewHeader>
      <ViewBody>
        <div className={styles.chatShell}>
          <div className={styles.chatRoot} ref={onChatContainerRef} />
        </div>
      </ViewBody>
    </>
  );
};
