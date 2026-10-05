import { IconButton, MenuItem, MenuSeparator, toast } from '@nota/component';
import { usePageHelper } from '@nota/core/blocksuite/block-suite-page-list/utils';
import { DocsService } from '@nota/core/modules/doc';
import { FavoriteService } from '@nota/core/modules/favorite';
import { TagService } from '@nota/core/modules/tag';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useServices } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback, useMemo } from 'react';
import {
  RiAddFill,
  RiDeleteBin6Fill,
  RiExternalLinkFill,
  RiLayoutRight2Fill,
  RiStarFill,
  RiStarLine,
} from 'react-icons/ri';

import type { NodeOperation } from '../../tree/types';

export const useNavigationPanelTagNodeOperations = (
  tagId: string,
  {
    openNodeCollapsed,
  }: {
    openNodeCollapsed: () => void;
  }
): NodeOperation[] => {
  const t = useI18n();
  const { workbenchService, workspaceService, tagService, favoriteService } =
    useServices({
      WorkbenchService,
      WorkspaceService,
      TagService,
      DocsService,
      FavoriteService,
    });

  const favorite = useLiveData(
    favoriteService.favoriteList.favorite$('tag', tagId)
  );
  const tagRecord = useLiveData(tagService.tagList.tagByTagId$(tagId));

  const { createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );

  const handleNewDoc = useCallback(() => {
    if (tagRecord) {
      const newDoc = createPage();
      tagRecord?.tag(newDoc.id);
      track.$.navigationPanel.tags.createDoc();
      openNodeCollapsed();
    }
  }, [createPage, openNodeCollapsed, tagRecord]);

  const handleMoveToTrash = useCallback(() => {
    tagService.tagList.deleteTag(tagId);
    track.$.navigationPanel.organize.deleteOrganizeItem({ type: 'tag' });
    toast(t['com.affine.tags.delete-tags.toast']());
  }, [t, tagId, tagService.tagList]);

  const handleOpenInSplitView = useCallback(() => {
    workbenchService.workbench.openTag(tagId, {
      at: 'beside',
    });
    track.$.navigationPanel.organize.openInSplitView({ type: 'tag' });
  }, [tagId, workbenchService]);

  const handleToggleFavoriteTag = useCallback(() => {
    favoriteService.favoriteList.toggle('tag', tagId);
    track.$.navigationPanel.organize.toggleFavorite({
      type: 'tag',
    });
  }, [favoriteService, tagId]);

  const handleOpenInNewTab = useCallback(() => {
    workbenchService.workbench.openTag(tagId, {
      at: 'new-tab',
    });
    track.$.navigationPanel.organize.openInNewTab({ type: 'tag' });
  }, [tagId, workbenchService]);

  return useMemo(
    () => [
      {
        index: 0,
        inline: true,
        view: (
          <IconButton
            size="16"
            onClick={handleNewDoc}
            data-testid="tag-add-doc-button"
            tooltip={t['com.affine.rootAppSidebar.explorer.tag-add-tooltip']()}
          >
            <RiAddFill size={16} />
          </IconButton>
        ),
      },
      {
        index: 50,
        view: (
          <MenuItem
            prefixIcon={<RiExternalLinkFill size={18} />}
            onClick={handleOpenInNewTab}
          >
            {t['com.affine.workbench.tab.page-menu-open']()}
          </MenuItem>
        ),
      },
      ...(BUILD_CONFIG.isElectron
        ? [
            {
              index: 100,
              view: (
                <MenuItem
                  prefixIcon={<RiLayoutRight2Fill size={18} />}
                  onClick={handleOpenInSplitView}
                >
                  {t['com.affine.workbench.split-view.page-menu-open']()}
                </MenuItem>
              ),
            },
          ]
        : []),
      {
        index: 199,
        view: (
          <MenuItem
            prefixIcon={
              favorite ? <RiStarFill size={18} /> : <RiStarLine size={18} />
            }
            onClick={handleToggleFavoriteTag}
          >
            {favorite
              ? t['com.affine.favoritePageOperation.remove']()
              : t['com.affine.favoritePageOperation.add']()}
          </MenuItem>
        ),
      },
      {
        index: 9999,
        view: <MenuSeparator key="menu-separator" />,
      },
      {
        index: 10000,
        view: (
          <MenuItem
            type={'danger'}
            prefixIcon={<RiDeleteBin6Fill size={18} />}
            onClick={handleMoveToTrash}
            data-testid="tag-delete-button"
          >
            {t['Delete']()}
          </MenuItem>
        ),
      },
    ],
    [
      favorite,
      handleMoveToTrash,
      handleNewDoc,
      handleOpenInNewTab,
      handleOpenInSplitView,
      handleToggleFavoriteTag,
      t,
    ]
  );
};
