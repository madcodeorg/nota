import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { DocModeProvider } from '@blocksuite/affine/shared/services';
import { createSignalFromObservable } from '@blocksuite/affine/shared/utils';
import { CenterPeekIcon } from '@blocksuite/icons/rc';
import { useConfirmModal } from '@nota/component';
import { NotaLogoIcon } from '@nota/component/auth-components';
import { AIProvider } from '@nota/core/blocksuite/ai';
import type { AgentActionProposal } from '@nota/core/blocksuite/ai/agent';
import type { AppSidebarConfig } from '@nota/core/blocksuite/ai/chat-panel/chat-config';
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
import { createPlaygroundModal } from '@nota/core/blocksuite/ai/components/playground/modal';
import { registerAIAppEffects } from '@nota/core/blocksuite/ai/effects/app';
import type { AffineEditorContainer } from '@nota/core/blocksuite/block-suite-editor';
import { NotificationServiceImpl } from '@nota/core/blocksuite/view-extensions/editor-view/notification-service';
import { useAIChatConfig } from '@nota/core/components/hooks/nota/use-ai-chat-config';
import { useAISpecs } from '@nota/core/components/hooks/nota/use-ai-specs';
import {
  AIDraftService,
  AIToolsConfigService,
} from '@nota/core/modules/ai-button';
import { AIModelService } from '@nota/core/modules/ai-button/services/models';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import { useSignalValue } from '@nota/core/modules/doc-info/utils';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { PeekViewService } from '@nota/core/modules/peek-view';
import { GuardService } from '@nota/core/modules/permissions';
import { AppThemeService } from '@nota/core/modules/theme';
import { WorkbenchService } from '@nota/core/modules/workbench';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import type {
  ContextEmbedStatus,
  CopilotChatHistoryFragment,
  UpdateChatSessionInput,
} from '@nota/graphql';
import { useI18n } from '@nota/i18n';
import { useFramework, useService } from '@nota/infra';
import type { Signal } from '@preact/signals-core';
import { html } from 'lit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createSessionDeleteHandler } from '../../chat-panel-utils';
import { useActionProposalHandlers } from '../../use-action-proposal-handlers';
import * as styles from './chat.css';
import {
  resolveInitialSession,
  type WorkbenchLike,
} from './chat-panel-session';

registerAIAppEffects();

export interface SidebarTabProps {
  editor: AffineEditorContainer | null;
  onLoad?: ((component: HTMLElement) => void) | null;
}

export const EditorChatPanel = ({ editor, onLoad }: SidebarTabProps) => {
  const framework = useFramework();
  const workbench = useService(WorkbenchService).workbench;
  const docsService = useService(DocsService);
  const workspaceService = useService(WorkspaceService);
  const t = useI18n();

  const { closeConfirmModal, openConfirmModal } = useConfirmModal();
  const notificationService = useMemo(
    () => new NotificationServiceImpl(closeConfirmModal, openConfirmModal),
    [closeConfirmModal, openConfirmModal]
  );
  const specs = useAISpecs();
  const {
    docDisplayConfig,
    searchMenuConfig,
    reasoningConfig,
    playgroundConfig,
  } = useAIChatConfig();
  const playgroundVisible = useSignalValue(playgroundConfig.visible) ?? false;

  const [session, setSession] = useState<
    CopilotChatHistoryFragment | null | undefined
  >(undefined);
  const [embeddingProgress, setEmbeddingProgress] = useState<[number, number]>([
    0, 0,
  ]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [hasPinned, setHasPinned] = useState(false);

  const [chatContent, setChatContent] = useState<AIChatContent | null>(null);
  const [chatToolbar, setChatToolbar] = useState<AIChatToolbar | null>(null);
  const [isBodyProvided, setIsBodyProvided] = useState(false);
  const [isHeaderProvided, setIsHeaderProvided] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatToolbarContainerRef = useRef<HTMLDivElement | null>(null);
  const contentKeyRef = useRef<string | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  const lastDocIdRef = useRef<string | null>(null);
  const sessionLoadSeqRef = useRef(0);

  const doc = editor?.doc;
  const host = editor?.host;

  const appSidebarConfig = useMemo<AppSidebarConfig>(() => {
    return {
      getWidth: () =>
        createSignalFromObservable<number | undefined>(
          workbench.sidebarWidth$.asObservable(),
          0
        ),
      isOpen: () =>
        createSignalFromObservable<boolean | undefined>(
          workbench.sidebarOpen$.asObservable(),
          true
        ),
    };
  }, [workbench]);

  const [sidebarWidthSignal, setSidebarWidthSignal] =
    useState<Signal<number | undefined>>();

  useEffect(() => {
    const { signal, cleanup } = appSidebarConfig.getWidth();
    setSidebarWidthSignal(signal);
    return cleanup;
  }, [appSidebarConfig]);

  const resetPanel = useCallback(() => {
    sessionLoadSeqRef.current += 1;
    setSession(undefined);
    setEmbeddingProgress([0, 0]);
    setHasPinned(false);
  }, []);

  const initPanel = useCallback(async () => {
    const requestSeq = ++sessionLoadSeqRef.current;
    try {
      const nextSession = await resolveInitialSession({
        sessionService: AIProvider.session ?? undefined,
        doc,
        workbench: workbench as WorkbenchLike,
      });

      if (requestSeq !== sessionLoadSeqRef.current) return;
      if (nextSession === undefined) {
        return;
      }

      setSession(nextSession);
      setHasPinned(!!nextSession?.pinned);
    } catch (error) {
      console.error(error);
    }
  }, [doc, workbench]);

  const createSession = useCallback(
    async (options: Partial<BlockSuitePresets.AICreateSessionOptions> = {}) => {
      if (session || !AIProvider.session || !doc) {
        return session ?? undefined;
      }
      const requestSeq = ++sessionLoadSeqRef.current;
      const nextSession = await AIProvider.session.createSessionWithHistory({
        docId: doc.id,
        workspaceId: doc.workspace.id,
        promptName: 'Chat With Nota AI',
        reuseLatestChat: false,
        ...options,
      });
      if (requestSeq !== sessionLoadSeqRef.current) return undefined;
      setSession(nextSession ?? null);
      setHasPinned(!!nextSession?.pinned);
      return nextSession ?? undefined;
    },
    [doc, session]
  );

  const updateSession = useCallback(
    async (options: UpdateChatSessionInput) => {
      if (!AIProvider.session || !doc) {
        return undefined;
      }
      const requestSeq = ++sessionLoadSeqRef.current;
      await AIProvider.session.updateSession(options);
      const nextSession = await AIProvider.session.getSession(
        doc.workspace.id,
        options.sessionId
      );
      if (requestSeq !== sessionLoadSeqRef.current) return undefined;
      setSession(nextSession ?? null);
      setHasPinned(!!nextSession?.pinned);
      return nextSession ?? undefined;
    },
    [doc]
  );

  const newSession = useCallback(async () => {
    resetPanel();
    const requestSeq = sessionLoadSeqRef.current;
    setSession(null);

    if (!AIProvider.session || !doc) {
      return;
    }

    try {
      const nextSession = await AIProvider.session.createSessionWithHistory({
        docId: doc.id,
        workspaceId: doc.workspace.id,
        promptName: 'Chat With Nota AI',
        reuseLatestChat: false,
      });
      if (requestSeq === sessionLoadSeqRef.current) {
        setSession(nextSession ?? null);
        setHasPinned(!!nextSession?.pinned);
      }
    } catch (error) {
      console.error(error);
    }
  }, [doc, resetPanel]);

  const openSession = useCallback(
    async (sessionId: string) => {
      if (session?.sessionId === sessionId || !AIProvider.session || !doc) {
        return;
      }
      const requestSeq = ++sessionLoadSeqRef.current;
      try {
        const nextSession = await AIProvider.session.getSession(
          doc.workspace.id,
          sessionId
        );
        if (requestSeq !== sessionLoadSeqRef.current) return;
        setSession(nextSession ?? null);
        setHasPinned(!!nextSession?.pinned);
      } catch (error) {
        console.error(error);
      }
    },
    [doc, session?.sessionId]
  );

  const openDoc = useCallback(
    async (docId: string, sessionId?: string) => {
      if (!doc) {
        return;
      }
      if (doc.id === docId) {
        if (session?.sessionId === sessionId || session?.pinned) {
          return;
        }
        if (sessionId) {
          await openSession(sessionId);
        }
        return;
      }
      if (session?.pinned || !sessionId) {
        workbench.open(`/${docId}`, { at: 'active' });
        return;
      }
      workbench.open(`/${docId}?sessionId=${sessionId}`, { at: 'active' });
    },
    [doc, openSession, session?.pinned, session?.sessionId, workbench]
  );

  const deleteSession = useMemo(
    () =>
      createSessionDeleteHandler({
        t,
        notificationService,
        canDeleteSession: () => Boolean(AIProvider.histories),
        cleanupSession: async sessionToDelete => {
          await AIProvider.histories?.cleanup(
            sessionToDelete.workspaceId,
            sessionToDelete.docId || undefined,
            [sessionToDelete.sessionId]
          );
        },
        isActiveSession: sessionToDelete =>
          sessionToDelete.sessionId === session?.sessionId,
        onActiveSessionDeleted: () => {
          newSession().catch(console.error);
        },
      }),
    [newSession, notificationService, session?.sessionId, t]
  );

  const togglePin = useCallback(async () => {
    const pinned = !session?.pinned;
    setHasPinned(true);
    if (!session) {
      await createSession({ pinned });
      return;
    }
    setSession(prev => (prev ? { ...prev, pinned } : prev));
    await updateSession({
      sessionId: session.sessionId,
      pinned,
    });
  }, [createSession, session, updateSession]);

  const rebindSession = useCallback(async () => {
    if (!session || !doc) {
      return;
    }
    if (session.docId !== doc.id) {
      await updateSession({
        sessionId: session.sessionId,
        docId: doc.id,
      });
    }
  }, [doc, session, updateSession]);

  const onEmbeddingProgressChange = useCallback(
    (count: Record<ContextEmbedStatus, number>) => {
      const total = count.finished + count.processing + count.failed;
      setEmbeddingProgress([count.finished, total]);
    },
    []
  );

  const onContextChange = useCallback(
    (context: Partial<ChatContextValue>) => {
      setStatus(context.status ?? 'idle');
      if (context.status === 'success') {
        rebindSession().catch(console.error);
      }
    },
    [rebindSession]
  );

  const getSelectionEditorContainer = useCallback(
    (
      proposal: Extract<
        AgentActionProposal,
        { type: 'insert_markdown' | 'replace_selection' }
      >
    ) => (editor?.host && editor.doc.id === proposal.docId ? editor : null),
    [editor]
  );
  const onOpenAppliedDoc = useCallback(
    (docId: string) => {
      openDoc(docId, session?.sessionId).catch(console.error);
    },
    [openDoc, session?.sessionId]
  );
  const {
    applyingProposalId,
    applyActionProposal,
    rejectActionProposal,
    undoActionProposal,
  } = useActionProposalHandlers({
    docsService,
    getSelectionEditorContainer,
    guardService: framework.getOptional(GuardService),
    isLocalWorkspace: isUserOwnedWorkspaceFlavour(
      workspaceService.workspace.flavour
    ),
    mindmapProvider: host?.std.store.provider,
    onOpenDoc: onOpenAppliedDoc,
    sessionId: session?.sessionId,
    workspace: workspaceService.workspace.docCollection,
    workspaceId: workspaceService.workspace.id,
  });

  useEffect(() => {
    if (session !== undefined) {
      return;
    }
    if (chatContent) {
      chatContent.remove();
      setChatContent(null);
    }
    if (chatToolbar) {
      chatToolbar.remove();
      setChatToolbar(null);
    }
  }, [chatContent, chatToolbar, session]);

  useEffect(() => {
    const subscription = AIProvider.slots.userInfo.subscribe(() => {
      resetPanel();
      initPanel().catch(console.error);
    });
    return () => subscription.unsubscribe();
  }, [initPanel, resetPanel]);

  useEffect(() => {
    const docId = doc?.id;
    if (!docId) {
      return;
    }
    if (
      lastDocIdRef.current &&
      lastDocIdRef.current !== docId &&
      !session?.pinned
    ) {
      resetPanel();
    }
    lastDocIdRef.current = docId;
  }, [doc?.id, resetPanel, session?.pinned]);

  useEffect(() => {
    if (!doc || session !== undefined) {
      return;
    }
    if (AIProvider.session) {
      initPanel().catch(console.error);
      return;
    }
    const subscription = AIProvider.slots.sessionReady.subscribe(ready => {
      if (!ready || session !== undefined) return;
      initPanel().catch(console.error);
    });
    return () => subscription.unsubscribe();
  }, [doc, initPanel, session]);

  const hasSessionHistory = !!session?.messages?.length;
  const sessionSwitched = !!(
    session?.sessionId &&
    prevSessionIdRef.current &&
    prevSessionIdRef.current !== session.sessionId
  );
  const contentKey =
    hasPinned || (session?.sessionId && (hasSessionHistory || sessionSwitched))
      ? (session?.sessionId ?? doc?.id ?? 'chat-panel')
      : (doc?.id ?? 'chat-panel');

  useEffect(() => {
    if (session?.sessionId) {
      prevSessionIdRef.current = session.sessionId;
    }
  }, [session?.sessionId]);

  useEffect(() => {
    if (!chatContent) {
      contentKeyRef.current = contentKey;
      return;
    }
    if (contentKeyRef.current && contentKeyRef.current !== contentKey) {
      chatContent.remove();
      setChatContent(null);
    }
    contentKeyRef.current = contentKey;
  }, [chatContent, contentKey]);

  useEffect(() => {
    if (!isBodyProvided || !chatContainerRef.current || !doc || !host) {
      return;
    }
    if (session === undefined) {
      return;
    }

    let content = chatContent;

    if (!content) {
      content = new AIChatContent();
    }

    content.host = host;
    content.session = session;
    content.createSession = createSession;
    content.workspaceId = doc.workspace.id;
    content.docId = doc.id;
    content.reasoningConfig = reasoningConfig;
    content.searchMenuConfig = searchMenuConfig;
    content.docDisplayConfig = docDisplayConfig;
    content.extensions = specs;
    content.affineFeatureFlagService = framework.get(FeatureFlagService);
    content.affineWorkspaceDialogService = framework.get(
      WorkspaceDialogService
    );
    content.affineThemeService = framework.get(AppThemeService);
    content.notificationService = notificationService;
    content.aiDraftService = framework.get(AIDraftService);
    content.aiToolsConfigService = framework.get(AIToolsConfigService);
    content.peekViewService = framework.get(PeekViewService);
    content.aiModelService = framework.get(AIModelService);
    content.onEmbeddingProgressChange = onEmbeddingProgressChange;
    content.onContextChange = onContextChange;
    content.width = sidebarWidthSignal;
    content.onOpenDoc = (docId: string, sessionId?: string) => {
      openDoc(docId, sessionId).catch(console.error);
    };
    content.applyingProposalId = applyingProposalId;
    content.onApplyActionProposal = applyActionProposal;
    content.onRejectActionProposal = rejectActionProposal;
    content.onUndoActionProposal = undoActionProposal;

    if (!chatContent) {
      chatContainerRef.current.append(content);
      setChatContent(content);
      onLoad?.(content);
    }
  }, [
    chatContent,
    applyingProposalId,
    applyActionProposal,
    createSession,
    doc,
    docDisplayConfig,
    framework,
    host,
    isBodyProvided,
    notificationService,
    onContextChange,
    onEmbeddingProgressChange,
    onLoad,
    openDoc,
    reasoningConfig,
    rejectActionProposal,
    searchMenuConfig,
    session,
    sidebarWidthSignal,
    specs,
    undoActionProposal,
  ]);

  useEffect(() => {
    if (!isHeaderProvided || !chatToolbarContainerRef.current || !doc) {
      return;
    }
    if (session === undefined) {
      return;
    }

    const tool = getOrCreateAIChatToolbar(chatToolbar);
    configureAIChatToolbar(tool, {
      session,
      workspaceId: doc.workspace.id,
      docId: doc.id,
      status,
      docDisplayConfig,
      notificationService,
      onNewSession: () => {
        newSession().catch(console.error);
      },
      onTogglePin: togglePin,
      onOpenSession: (sessionId: string) => {
        openSession(sessionId).catch(console.error);
      },
      onOpenDoc: (docId: string, sessionId: string) => {
        openDoc(docId, sessionId).catch(console.error);
      },
      onSessionDelete: (sessionToDelete: BlockSuitePresets.AIRecentSession) => {
        deleteSession(sessionToDelete).catch(console.error);
      },
    });

    if (!chatToolbar) {
      chatToolbarContainerRef.current.append(tool);
      setChatToolbar(tool);
    }
  }, [
    chatToolbar,
    deleteSession,
    doc,
    docDisplayConfig,
    isHeaderProvided,
    newSession,
    notificationService,
    openDoc,
    openSession,
    session,
    status,
    togglePin,
  ]);

  useEffect(() => {
    if (!editor?.host || !chatContent) {
      return;
    }
    const docModeService = editor.host.std.get(DocModeProvider);
    const refNodeService = editor.host.std.getOptional(RefNodeSlotsProvider);
    const disposable = [
      refNodeService?.docLinkClicked.subscribe(({ host: clickedHost }) => {
        if (clickedHost === editor.host) {
          chatContent.docId = editor.doc.id;
        }
      }),
      docModeService?.onPrimaryModeChange(() => {
        if (!editor.host) {
          return;
        }
        chatContent.host = editor.host;
      }, editor.doc.id),
    ];

    return () => disposable.forEach(item => item?.unsubscribe());
  }, [chatContent, editor]);

  const [autoResized, setAutoResized] = useState(false);
  useEffect(() => {
    if (autoResized) {
      return;
    }
    const subscription = AIProvider.slots.previewPanelOpenChange.subscribe(
      open => {
        if (!open) {
          return;
        }
        const sidebarWidth = workbench.sidebarWidth$.value;
        const minSidebarWidth = 1080;
        if (!sidebarWidth || sidebarWidth < minSidebarWidth) {
          workbench.setSidebarWidth(minSidebarWidth);
          setAutoResized(true);
        }
      }
    );
    return () => {
      subscription.unsubscribe();
    };
  }, [autoResized, workbench]);

  const openPlayground = useCallback(() => {
    if (!doc || !host) {
      return;
    }
    const playgroundContent = html`
      <playground-content
        .host=${host}
        .doc=${doc}
        .reasoningConfig=${reasoningConfig}
        .playgroundConfig=${playgroundConfig}
        .appSidebarConfig=${appSidebarConfig}
        .searchMenuConfig=${searchMenuConfig}
        .docDisplayConfig=${docDisplayConfig}
        .extensions=${specs}
        .affineFeatureFlagService=${framework.get(FeatureFlagService)}
        .affineThemeService=${framework.get(AppThemeService)}
        .notificationService=${notificationService}
        .affineWorkspaceDialogService=${framework.get(WorkspaceDialogService)}
        .aiToolsConfigService=${framework.get(AIToolsConfigService)}
        .aiModelService=${framework.get(AIModelService)}
        .applyingProposalId=${applyingProposalId}
        .onApplyActionProposal=${applyActionProposal}
        .onRejectActionProposal=${rejectActionProposal}
        .onUndoActionProposal=${undoActionProposal}
      ></playground-content>
    `;

    createPlaygroundModal(playgroundContent, 'AI Playground');
  }, [
    appSidebarConfig,
    applyingProposalId,
    applyActionProposal,
    doc,
    docDisplayConfig,
    framework,
    host,
    notificationService,
    playgroundConfig,
    reasoningConfig,
    rejectActionProposal,
    searchMenuConfig,
    specs,
    undoActionProposal,
  ]);

  const onChatContainerRef = useCallback((node: HTMLDivElement) => {
    if (!node) {
      return;
    }
    setIsBodyProvided(true);
    chatContainerRef.current = node;
  }, []);

  const onChatToolContainerRef = useCallback((node: HTMLDivElement) => {
    if (!node) {
      return;
    }
    setIsHeaderProvided(true);
    chatToolbarContainerRef.current = node;
  }, []);

  const isEmbedding =
    embeddingProgress[1] > 0 && embeddingProgress[0] < embeddingProgress[1];
  const [done, total] = embeddingProgress;
  const isInitialized = session !== undefined;

  return (
    <div className={styles.root}>
      {!isInitialized ? (
        <div className={styles.loadingContainer}>
          <div className={styles.loading}>
            <NotaLogoIcon className={styles.loadingIcon} />
            <div className={styles.loadingTitle}>
              {t['com.affine.ai.chat-panel.loading-history']()}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.title}>
              {isEmbedding ? (
                <span data-testid="chat-panel-embedding-progress">
                  {t.t('com.affine.ai.chat-panel.embedding-progress', {
                    done,
                    total,
                  })}
                </span>
              ) : (
                t['com.affine.ai.chat-panel.title']()
              )}
            </div>
            {playgroundVisible ? (
              <div className={styles.playground} onClick={openPlayground}>
                <CenterPeekIcon />
              </div>
            ) : null}
            <div ref={onChatToolContainerRef} />
          </div>
          <div className={styles.content} ref={onChatContainerRef} />
        </div>
      )}
    </div>
  );
};
