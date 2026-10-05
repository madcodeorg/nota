import type { EditorHost } from '@blocksuite/affine/std';
import { toReactNode } from '@nota/component';
import { AIChatBlockPeekViewTemplate } from '@nota/core/blocksuite/ai';
import type { AgentActionProposal } from '@nota/core/blocksuite/ai/agent';
import type { AIChatBlockModel } from '@nota/core/blocksuite/ai/blocks/ai-chat-block/model/ai-chat-model';
import { registerAIAppEffects } from '@nota/core/blocksuite/ai/effects/app';
import { useAIChatConfig } from '@nota/core/components/hooks/nota/use-ai-chat-config';
import { useActionProposalHandlers } from '@nota/core/desktop/pages/workspace/use-action-proposal-handlers';
import {
  AIDraftService,
  AIToolsConfigService,
} from '@nota/core/modules/ai-button';
import { AIModelService } from '@nota/core/modules/ai-button/services/models';
import { ServerService } from '@nota/core/modules/cloud';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import { EditorService } from '@nota/core/modules/editor';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { GuardService } from '@nota/core/modules/permissions';
import { WorkbenchService } from '@nota/core/modules/workbench/services/workbench';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useFramework, useService } from '@nota/infra';
import { useCallback, useMemo } from 'react';

registerAIAppEffects();

export type AIChatBlockPeekViewProps = {
  model: AIChatBlockModel;
  host: EditorHost;
};

export const AIChatBlockPeekView = ({
  model,
  host,
}: AIChatBlockPeekViewProps) => {
  const { docDisplayConfig, searchMenuConfig, reasoningConfig } =
    useAIChatConfig();

  const framework = useFramework();
  const docsService = useService(DocsService);
  const workspaceService = useService(WorkspaceService);
  const workbench = useService(WorkbenchService).workbench;
  const serverService = framework.get(ServerService);
  const affineFeatureFlagService = framework.get(FeatureFlagService);
  const affineWorkspaceDialogService = framework.get(WorkspaceDialogService);
  const aiDraftService = framework.get(AIDraftService);
  const aiToolsConfigService = framework.get(AIToolsConfigService);
  const aiModelService = framework.get(AIModelService);
  const getSelectionEditorContainer = useCallback(
    (
      proposal: Extract<
        AgentActionProposal,
        { type: 'insert_markdown' | 'replace_selection' }
      >
    ) => {
      const editorContainer =
        framework.getOptional(EditorService)?.editor.editorContainer$.value ??
        null;
      return editorContainer?.host && editorContainer.doc.id === proposal.docId
        ? editorContainer
        : null;
    },
    [framework]
  );
  const onOpenDoc = useCallback(
    (docId: string) => workbench.openDoc(docId, { at: 'active' }),
    [workbench]
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
    mindmapProvider: host.std.store.provider,
    onOpenDoc,
    sessionId: model.props.sessionId,
    workspace: workspaceService.workspace.docCollection,
    workspaceId: workspaceService.workspace.id,
  });

  return useMemo(() => {
    const template = AIChatBlockPeekViewTemplate(
      model,
      host,
      docDisplayConfig,
      searchMenuConfig,
      reasoningConfig,
      serverService,
      affineFeatureFlagService,
      affineWorkspaceDialogService,
      aiDraftService,
      aiToolsConfigService,
      aiModelService,
      applyingProposalId,
      applyActionProposal,
      rejectActionProposal,
      undoActionProposal
    );
    return toReactNode(template);
  }, [
    model,
    host,
    docDisplayConfig,
    searchMenuConfig,
    reasoningConfig,
    serverService,
    affineFeatureFlagService,
    affineWorkspaceDialogService,
    aiDraftService,
    aiToolsConfigService,
    aiModelService,
    applyingProposalId,
    applyActionProposal,
    rejectActionProposal,
    undoActionProposal,
  ]);
};
