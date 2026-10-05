import { useConfirmModal, useLitPortalFactory } from '@nota/component';
import { getViewManager } from '@nota/core/blocksuite/manager/view';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import {
  isServerBackedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useFramework, useLiveData, useServices } from '@nota/infra';
import { useMemo } from 'react';

import { useEnableAI } from './use-enable-ai';

export const useAISpecs = () => {
  const framework = useFramework();
  const enableAI = useEnableAI();
  const confirmModal = useConfirmModal();
  const [reactToLit, _portals] = useLitPortalFactory();

  const { workspaceService, featureFlagService } = useServices({
    WorkspaceService,
    FeatureFlagService,
  });

  const enablePDFEmbedPreview = useLiveData(
    featureFlagService.flags.enable_pdf_embed_preview.$
  );

  const isCloud = isServerBackedWorkspaceFlavour(
    workspaceService.workspace.flavour
  );

  const specs = useMemo(() => {
    const manager = getViewManager()
      .config.init()
      .foundation(framework)
      .ai(enableAI, framework)
      .editorConfig(framework)
      .editorView({
        framework,
        reactToLit,
        confirmModal,
        scope: 'workspace',
      })
      .cloud(framework, isCloud)
      .pdf(enablePDFEmbedPreview, reactToLit)
      .database(framework)
      .linkedDoc(framework)
      .paragraph(enableAI)
      .mobile(framework)
      .electron(framework)
      .linkPreview(framework)
      .iconPicker(framework)
      .codeBlockPreview(framework).value;

    return manager.get('page');
  }, [
    framework,
    reactToLit,
    enableAI,
    enablePDFEmbedPreview,
    isCloud,
    confirmModal,
  ]);

  return specs;
};
