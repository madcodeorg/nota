import {
  type DropTargetDropEvent,
  type DropTargetOptions,
  IconButton,
  MenuItem,
  toast,
} from '@nota/component';
import { usePageHelper } from '@nota/core/blocksuite/block-suite-page-list/utils';
import { NavigationPanelService } from '@nota/core/modules/navigation-panel';
import { type FolderNode, OrganizeService } from '@nota/core/modules/organize';
import { WorkspaceService } from '@nota/core/modules/workspace';
import type { AffineDNDData } from '@nota/core/types/dnd';
import { useI18n } from '@nota/i18n';
import { useLiveData, useServices } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RiAddFill,
  RiFolder3Line,
  RiFolderAddFill,
  RiFolderForbidFill,
} from 'react-icons/ri';

import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelFolderNode } from '../../nodes/folder';
import { NavigationPanelTreeRoot } from '../../tree';
import type { NodeOperation } from '../../tree/types';
import { organizeChildrenDropEffect } from './dnd';
import { RootEmpty } from './empty';

export const NavigationPanelOrganize = () => {
  const { organizeService, navigationPanelService, workspaceService } =
    useServices({
      OrganizeService,
      NavigationPanelService,
      WorkspaceService,
    });
  const path = useMemo(() => ['organize'], []);
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const t = useI18n();

  const folderTree = organizeService.folderTree;
  const rootFolder = folderTree.rootFolder;

  const folders = useLiveData(rootFolder.sortedChildren$);
  const isLoading = useLiveData(folderTree.isLoading$);
  const { createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );

  const handleCreateFolder = useCallback(() => {
    const newFolderId = rootFolder.createFolder(
      'New Folder',
      rootFolder.indexAt('before')
    );
    track.$.navigationPanel.organize.createOrganizeItem({ type: 'folder' });
    setNewFolderId(newFolderId);
    navigationPanelService.setCollapsed(path, false);
    return newFolderId;
  }, [navigationPanelService, path, rootFolder]);

  const handleCreatePage = useCallback(() => {
    const newDoc = createPage();
    rootFolder.createLink('doc', newDoc.id, rootFolder.indexAt('before'));
    track.$.navigationPanel.organize.createOrganizeItem({
      type: 'link',
      target: 'doc',
    });
    navigationPanelService.setCollapsed(path, false);
  }, [createPage, navigationPanelService, path, rootFolder]);

  const handleOnChildrenDrop = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>, node?: FolderNode) => {
      if (!node || !node.id) {
        return; // never happens
      }
      if (
        data.treeInstruction?.type === 'reorder-above' ||
        data.treeInstruction?.type === 'reorder-below'
      ) {
        const at =
          data.treeInstruction?.type === 'reorder-below' ? 'after' : 'before';
        if (data.source.data.entity?.type === 'folder') {
          rootFolder.moveHere(
            data.source.data.entity.id,
            rootFolder.indexAt(at, node.id)
          );
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (data.source.data.entity?.type === 'doc') {
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            rootFolder.moveHere(
              data.source.data.from.nodeId,
              rootFolder.indexAt(at, node.id)
            );
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: 'doc',
            });
          } else {
            rootFolder.createLink(
              'doc',
              data.source.data.entity.id,
              rootFolder.indexAt(at, node.id)
            );
            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: 'doc',
            });
          }
        } else {
          toast(t['com.affine.rootAppSidebar.organize.root-folder-only']());
        }
      } else {
        return; // not supported
      }
    },
    [rootFolder, t]
  );

  const createFolderAndDrop = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      const entity = data.source.data.entity;
      if (!entity) return;
      const { type, id } = entity;
      if (type === 'doc') {
        rootFolder.createLink('doc', id, rootFolder.indexAt('after'));
        navigationPanelService.setCollapsed(path, false);
        track.$.navigationPanel.organize.createOrganizeItem({
          type: 'link',
          target: 'doc',
        });
        return;
      }
      if (type !== 'tag' && type !== 'collection') return;

      const newFolderId = handleCreateFolder();
      setNewFolderId(null);
      const newFolder$ = folderTree.folderNode$(newFolderId);
      const folder = newFolder$.value;
      if (!folder) return;
      folder.createLink(type, id, folder.indexAt('after'));
    },
    [folderTree, handleCreateFolder, navigationPanelService, path, rootFolder]
  );

  const handleChildrenCanDrop = useMemo<
    DropTargetOptions<AffineDNDData>['canDrop']
  >(
    () => args =>
      args.source.data.entity?.type === 'folder' ||
      args.source.data.entity?.type === 'doc',
    []
  );

  const rootChildOperations = useCallback(
    (type: string, childNode: FolderNode): NodeOperation[] => {
      if (type !== 'doc') {
        return [];
      }
      return [
        {
          index: 999,
          view: (
            <MenuItem
              type="danger"
              prefixIcon={<RiFolderForbidFill size={18} />}
              onClick={() => childNode.delete()}
            >
              Remove from sidebar
            </MenuItem>
          ),
        },
      ];
    },
    []
  );

  useEffect(() => {
    if (collapsed) setNewFolderId(null); // reset new folder id to clear the renaming state
  }, [collapsed]);

  return (
    <CollapsibleSection
      path={path}
      title={'Pages & Folders'}
      icon={<RiFolder3Line />}
      actions={
        <>
          <IconButton
            data-testid="navigation-panel-bar-add-page-button"
            onClick={handleCreatePage}
            size="16"
            tooltip="New page"
          >
            <RiAddFill size={16} />
          </IconButton>
          <IconButton
            data-testid="navigation-panel-bar-add-organize-button"
            onClick={handleCreateFolder}
            size="16"
            tooltip={t[
              'com.affine.rootAppSidebar.explorer.organize-section-add-tooltip'
            ]()}
          >
            <RiFolderAddFill size={16} />
          </IconButton>
        </>
      }
    >
      <NavigationPanelTreeRoot
        placeholder={
          <RootEmpty
            onClickCreate={handleCreateFolder}
            isLoading={isLoading}
            onDrop={createFolderAndDrop}
          />
        }
      >
        {folders.map(child => (
          <NavigationPanelFolderNode
            key={child.id}
            nodeId={child.id as string}
            defaultRenaming={child.id === newFolderId}
            onDrop={handleOnChildrenDrop}
            operations={rootChildOperations}
            dropEffect={organizeChildrenDropEffect}
            canDrop={handleChildrenCanDrop}
            location={{
              at: 'navigation-panel:organize:folder-node',
              nodeId: child.id as string,
            }}
            parentPath={path}
          />
        ))}
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
