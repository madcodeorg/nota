import {
  type DropTargetDropEvent,
  type DropTargetOptions,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSub,
  notify,
} from '@nota/component';
import { usePageHelper } from '@nota/core/blocksuite/block-suite-page-list/utils';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import { CompatibleFavoriteItemsAdapter } from '@nota/core/modules/favorite';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { GlobalContextService } from '@nota/core/modules/global-context';
import { NavigationPanelService } from '@nota/core/modules/navigation-panel';
import { type FolderNode, OrganizeService } from '@nota/core/modules/organize';
import { WorkspaceService } from '@nota/core/modules/workspace';
import type { AffineDNDData } from '@nota/core/types/dnd';
import { Unreachable } from '@nota/env/constant';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService, useServices } from '@nota/infra';
import { track } from '@nota/track';
import { difference } from 'lodash-es';
import { useCallback, useMemo, useState } from 'react';
import {
  RiAddFill,
  RiArchiveStackFill,
  RiDeleteBin6Fill,
  RiFileAddFill,
  RiFileTextFill,
  RiFolder3Fill,
  RiFolderForbidFill,
  RiFolderOpenFill,
  RiPriceTag3Fill,
} from 'react-icons/ri';

import {
  NavigationPanelTreeNode,
  type NavigationPanelTreeNodeDropEffect,
} from '../../tree';
import type { NavigationPanelTreeNodeIcon } from '../../tree/node';
import type { NodeOperation } from '../../tree/types';
import { NavigationPanelCollectionNode } from '../collection';
import { useNavigationPanelDocNodeOperations } from '../doc/operations';
import { NavigationPanelTagNode } from '../tag';
import type { GenericNavigationPanelNode } from '../types';
import { FolderEmpty } from './empty';
import { FavoriteFolderOperation } from './operations';

const getDraggedOrganizeNodeId = (
  draggable: AffineDNDData['draggable'] | undefined
): string | null => {
  if (!draggable) return null;
  if (draggable.entity?.type === 'folder') {
    return draggable.entity.id;
  }
  if (draggable.from?.at === 'navigation-panel:organize:folder-node') {
    return draggable.from.nodeId;
  }
  return null;
};

const isInvalidSelfOrAncestorDrop = (
  targetNode: FolderNode,
  draggable: AffineDNDData['draggable'] | undefined
) => {
  const sourceNodeId = getDraggedOrganizeNodeId(draggable);
  return (
    !!sourceNodeId &&
    (targetNode.id === sourceNodeId || targetNode.beChildOf(sourceNodeId))
  );
};

export const NavigationPanelFolderNode = ({
  nodeId,
  onDrop,
  defaultRenaming,
  operations,
  location,
  dropEffect,
  canDrop,
  reorderable,
  parentPath,
}: {
  defaultRenaming?: boolean;
  nodeId: string;
  onDrop?: (data: DropTargetDropEvent<AffineDNDData>, node: FolderNode) => void;
  operations?:
    NodeOperation[] | ((type: string, node: FolderNode) => NodeOperation[]);
} & Omit<GenericNavigationPanelNode, 'operations'>) => {
  const { organizeService } = useServices({
    OrganizeService,
  });
  const node = useLiveData(organizeService.folderTree.folderNode$(nodeId));
  const type = useLiveData(node?.type$);
  const data = useLiveData(node?.data$);
  const handleDrop = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (!node) {
        return;
      }
      onDrop?.(data, node);
    },
    [node, onDrop]
  );
  const additionalOperations = useMemo(() => {
    if (!type || !node) {
      return;
    }
    if (typeof operations === 'function') {
      return operations(type, node);
    }
    return operations;
  }, [node, operations, type]);

  if (!node) {
    return;
  }

  if (type === 'folder') {
    return (
      <NavigationPanelFolderNodeFolder
        node={node}
        onDrop={handleDrop}
        defaultRenaming={defaultRenaming}
        operations={additionalOperations}
        dropEffect={dropEffect}
        reorderable={reorderable}
        canDrop={canDrop}
        parentPath={parentPath}
      />
    );
  } else if (type === 'doc') {
    return (
      data && (
        <NavigationPanelFolderDocNode
          node={node}
          docId={data}
          location={location}
          onDrop={handleDrop}
          reorderable={reorderable}
          canDrop={canDrop}
          dropEffect={dropEffect}
          operations={additionalOperations}
          parentPath={parentPath}
        />
      )
    );
  } else if (type === 'collection') {
    return (
      data && (
        <NavigationPanelCollectionNode
          collectionId={data}
          location={location}
          onDrop={handleDrop}
          canDrop={canDrop}
          reorderable={reorderable}
          dropEffect={dropEffect}
          operations={additionalOperations}
          parentPath={parentPath}
        />
      )
    );
  } else if (type === 'tag') {
    return (
      data && (
        <NavigationPanelTagNode
          tagId={data}
          location={location}
          onDrop={handleDrop}
          canDrop={canDrop}
          reorderable
          dropEffect={dropEffect}
          operations={additionalOperations}
          parentPath={parentPath}
        />
      )
    );
  }

  return;
};

// Define outside the `NavigationPanelFolderNodeFolder` to avoid re-render(the close animation won't play)
const NavigationPanelFolderIcon: NavigationPanelTreeNodeIcon = ({
  collapsed,
  className,
  draggedOver,
  treeInstruction,
}) => {
  const FolderIcon =
    !collapsed || (!!draggedOver && treeInstruction?.type === 'make-child')
      ? RiFolderOpenFill
      : RiFolder3Fill;
  return <FolderIcon className={className} size={18} />;
};

const NavigationPanelFolderNodeFolder = ({
  node,
  onDrop,
  defaultRenaming,
  location,
  operations: additionalOperations,
  canDrop,
  dropEffect,
  reorderable,
  parentPath,
}: {
  defaultRenaming?: boolean;
  node: FolderNode;
} & GenericNavigationPanelNode) => {
  const t = useI18n();
  const { workspaceService, featureFlagService, workspaceDialogService } =
    useServices({
      WorkspaceService,
      CompatibleFavoriteItemsAdapter,
      FeatureFlagService,
      WorkspaceDialogService,
    });
  const navigationPanelService = useService(NavigationPanelService);
  const name = useLiveData(node.name$);
  const enableEmojiIcon = useLiveData(
    featureFlagService.flags.enable_emoji_folder_icon.$
  );
  const path = useMemo(
    () => [...(parentPath ?? []), `folder-${node.id}`],
    [parentPath, node.id]
  );
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => {
      navigationPanelService.setCollapsed(path, value);
    },
    [navigationPanelService, path]
  );
  const [newFolderId, setNewFolderId] = useState<string | null>(null);

  const { createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );
  const handleDelete = useCallback(() => {
    node.delete();
    track.$.navigationPanel.organize.deleteOrganizeItem({
      type: 'folder',
    });
    notify.success({
      title: t['com.affine.rootAppSidebar.organize.delete.notify-title']({
        name,
      }),
      message: t['com.affine.rootAppSidebar.organize.delete.notify-message'](),
    });
  }, [name, node, t]);

  const children = useLiveData(node.sortedChildren$);

  const dndData = useMemo(() => {
    if (!node.id) {
      throw new Unreachable();
    }
    return {
      draggable: {
        entity: {
          type: 'folder',
          id: node.id,
        },
        from: location,
      },
      dropTarget: {
        at: 'navigation-panel:organize:folder',
      },
    } satisfies AffineDNDData;
  }, [location, node.id]);

  const handleRename = useCallback(
    (newName: string) => {
      node.rename(newName);
    },
    [node]
  );

  const handleDropOnFolder = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (data.source.data.entity?.type) {
        track.$.navigationPanel.folders.drop({
          type: data.source.data.entity.type,
        });
      }
      if (data.treeInstruction?.type === 'make-child') {
        if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
          return;
        }
        if (data.source.data.entity?.type === 'folder') {
          node.moveHere(data.source.data.entity.id, node.indexAt('before'));
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'tag'
        ) {
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            node.moveHere(data.source.data.from.nodeId, node.indexAt('before'));
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          } else {
            node.createLink(
              data.source.data.entity?.type,
              data.source.data.entity.id,
              node.indexAt('before')
            );
            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          }
        }
      } else {
        onDrop?.(data);
      }
    },
    [node, onDrop]
  );

  const handleDropEffect = useCallback<NavigationPanelTreeNodeDropEffect>(
    data => {
      if (data.treeInstruction?.type === 'make-child') {
        if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
          return;
        }
        if (data.source.data.entity?.type === 'folder') {
          return 'move';
        } else if (
          data.source.data.from?.at === 'navigation-panel:organize:folder-node'
        ) {
          return 'move';
        } else if (
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'tag'
        ) {
          return 'link';
        }
      } else {
        return dropEffect?.(data);
      }
      return;
    },
    [dropEffect, node]
  );

  const handleDropOnPlaceholder = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (data.source.data.entity?.type) {
        track.$.navigationPanel.folders.drop({
          type: data.source.data.entity.type,
        });
      }
      if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
        return;
      }
      if (data.source.data.entity?.type === 'folder') {
        node.moveHere(data.source.data.entity.id, node.indexAt('before'));
        track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
      } else if (
        data.source.data.entity?.type === 'collection' ||
        data.source.data.entity?.type === 'doc' ||
        data.source.data.entity?.type === 'tag'
      ) {
        if (
          data.source.data.from?.at === 'navigation-panel:organize:folder-node'
        ) {
          node.moveHere(data.source.data.from.nodeId, node.indexAt('before'));
          track.$.navigationPanel.organize.moveOrganizeItem({
            type: data.source.data.entity?.type,
          });
        } else {
          node.createLink(
            data.source.data.entity?.type,
            data.source.data.entity.id,
            node.indexAt('before')
          );
          track.$.navigationPanel.organize.createOrganizeItem({
            type: 'link',
            target: data.source.data.entity?.type,
          });
        }
      }
    },
    [node]
  );

  const handleDropOnChildren = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>, dropAtNode?: FolderNode) => {
      if (!dropAtNode || !dropAtNode.id) {
        return;
      }
      if (data.source.data.entity?.type) {
        track.$.navigationPanel.folders.drop({
          type: data.source.data.entity.type,
        });
      }
      if (
        data.treeInstruction?.type === 'reorder-above' ||
        data.treeInstruction?.type === 'reorder-below'
      ) {
        if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
          return;
        }
        const at =
          data.treeInstruction?.type === 'reorder-below' ? 'after' : 'before';
        if (data.source.data.entity?.type === 'folder') {
          node.moveHere(
            data.source.data.entity.id,
            node.indexAt(at, dropAtNode.id)
          );
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'tag'
        ) {
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            node.moveHere(
              data.source.data.from.nodeId,
              node.indexAt(at, dropAtNode.id)
            );
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          } else {
            node.createLink(
              data.source.data.entity?.type,
              data.source.data.entity.id,
              node.indexAt(at, dropAtNode.id)
            );

            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: data.source.data.entity?.type,
            });
          }
        }
      } else if (data.treeInstruction?.type === 'reparent') {
        const currentLevel = data.treeInstruction.currentLevel;
        const desiredLevel = data.treeInstruction.desiredLevel;
        if (currentLevel === desiredLevel + 1) {
          onDrop?.({
            ...data,
            treeInstruction: {
              type: 'reorder-below',
              currentLevel,
              indentPerLevel: data.treeInstruction.indentPerLevel,
            },
          });
          return;
        } else {
          onDrop?.({
            ...data,
            treeInstruction: {
              ...data.treeInstruction,
              currentLevel: currentLevel - 1,
            },
          });
        }
      }
    },
    [node, onDrop]
  );

  const handleDropEffectOnChildren =
    useCallback<NavigationPanelTreeNodeDropEffect>(
      data => {
        if (
          data.treeInstruction?.type === 'reorder-above' ||
          data.treeInstruction?.type === 'reorder-below'
        ) {
          if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
            return;
          }
          if (data.source.data.entity?.type === 'folder') {
            return 'move';
          } else if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            return 'move';
          } else if (
            data.source.data.entity?.type === 'collection' ||
            data.source.data.entity?.type === 'doc' ||
            data.source.data.entity?.type === 'tag'
          ) {
            return 'link';
          }
        } else if (data.treeInstruction?.type === 'reparent') {
          const currentLevel = data.treeInstruction.currentLevel;
          const desiredLevel = data.treeInstruction.desiredLevel;
          if (currentLevel === desiredLevel + 1) {
            dropEffect?.({
              ...data,
              treeInstruction: {
                type: 'reorder-below',
                currentLevel,
                indentPerLevel: data.treeInstruction.indentPerLevel,
              },
            });
            return;
          } else {
            dropEffect?.({
              ...data,
              treeInstruction: {
                ...data.treeInstruction,
                currentLevel: currentLevel - 1,
              },
            });
          }
        }
        return;
      },
      [dropEffect, node]
    );

  const handleCanDrop = useMemo<DropTargetOptions<AffineDNDData>['canDrop']>(
    () => args => {
      const entityType = args.source.data.entity?.type;
      if (args.treeInstruction && args.treeInstruction?.type !== 'make-child') {
        return (
          (typeof canDrop === 'function' ? canDrop(args) : canDrop) ?? true
        );
      }

      if (isInvalidSelfOrAncestorDrop(node, args.source.data)) {
        return false;
      }
      return (
        entityType === 'folder' ||
        args.source.data.from?.at === 'navigation-panel:organize:folder-node' ||
        entityType === 'collection' ||
        entityType === 'doc' ||
        entityType === 'tag'
      );
    },
    [canDrop, node]
  );

  const handleChildrenCanDrop = useMemo<
    DropTargetOptions<AffineDNDData>['canDrop']
  >(
    () => args => {
      const entityType = args.source.data.entity?.type;
      if (isInvalidSelfOrAncestorDrop(node, args.source.data)) {
        return false;
      }
      return (
        entityType === 'folder' ||
        args.source.data.from?.at === 'navigation-panel:organize:folder-node' ||
        entityType === 'collection' ||
        entityType === 'doc' ||
        entityType === 'tag'
      );
    },
    [node]
  );

  const handleNewDoc = useCallback(() => {
    const newDoc = createPage();
    node.createLink('doc', newDoc.id, node.indexAt('before'));
    track.$.navigationPanel.folders.createDoc();
    track.$.navigationPanel.organize.createOrganizeItem({
      type: 'link',
      target: 'doc',
    });
    setCollapsed(false);
  }, [createPage, node, setCollapsed]);

  const handleCreateSubfolder = useCallback(() => {
    const newFolderId = node.createFolder(
      t['com.affine.rootAppSidebar.organize.new-folders'](),
      node.indexAt('before')
    );
    track.$.navigationPanel.organize.createOrganizeItem({ type: 'folder' });
    setCollapsed(false);
    setNewFolderId(newFolderId);
  }, [node, setCollapsed, t]);

  const handleAddToFolder = useCallback(
    (type: 'doc' | 'collection' | 'tag') => {
      const initialIds = children
        .filter(node => node.type$.value === type)
        .map(node => node.data$.value)
        .filter(Boolean) as string[];
      const selector =
        type === 'doc'
          ? 'doc-selector'
          : type === 'collection'
            ? 'collection-selector'
            : 'tag-selector';
      workspaceDialogService.open(
        selector,
        {
          init: initialIds,
        },
        selectedIds => {
          if (selectedIds === undefined) {
            return;
          }
          const newItemIds = difference(selectedIds, initialIds);
          const removedItemIds = difference(initialIds, selectedIds);
          const removedItems = children.filter(
            node =>
              !!node.data$.value && removedItemIds.includes(node.data$.value)
          );

          newItemIds.forEach(id => {
            node.createLink(type, id, node.indexAt('after'));
          });
          removedItems.forEach(node => node.delete());
          const updated = newItemIds.length + removedItems.length;
          updated && setCollapsed(false);
        }
      );
      track.$.navigationPanel.organize.createOrganizeItem({
        type: 'link',
        target: type,
      });
    },
    [children, node, setCollapsed, workspaceDialogService]
  );

  const folderOperations = useMemo(() => {
    return [
      {
        index: 0,
        inline: true,
        view: (
          <IconButton
            size="16"
            onClick={handleNewDoc}
            tooltip={t[
              'com.affine.rootAppSidebar.explorer.organize-add-tooltip'
            ]()}
          >
            <RiAddFill size={16} />
          </IconButton>
        ),
      },
      {
        index: 100,
        view: (
          <MenuItem
            prefixIcon={<RiFolder3Fill size={18} />}
            onClick={handleCreateSubfolder}
          >
            {t['com.affine.rootAppSidebar.organize.folder.create-subfolder']()}
          </MenuItem>
        ),
      },
      {
        index: 101,
        view: (
          <MenuItem
            prefixIcon={<RiFileTextFill size={18} />}
            onClick={() => handleAddToFolder('doc')}
          >
            {t['com.affine.rootAppSidebar.organize.folder.add-docs']()}
          </MenuItem>
        ),
      },
      {
        index: 102,
        view: (
          <MenuSub
            triggerOptions={{
              prefixIcon: <RiAddFill size={18} />,
            }}
            items={
              <>
                <MenuItem
                  onClick={() => handleAddToFolder('tag')}
                  prefixIcon={<RiPriceTag3Fill size={18} />}
                >
                  {t['com.affine.rootAppSidebar.organize.folder.add-tags']()}
                </MenuItem>
                <MenuItem
                  onClick={() => handleAddToFolder('collection')}
                  prefixIcon={<RiArchiveStackFill size={18} />}
                >
                  {t[
                    'com.affine.rootAppSidebar.organize.folder.add-collections'
                  ]()}
                </MenuItem>
              </>
            }
          >
            {t['com.affine.rootAppSidebar.organize.folder.add-others']()}
          </MenuSub>
        ),
      },

      {
        index: 200,
        view: node.id ? <FavoriteFolderOperation id={node.id} /> : null,
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
            onClick={handleDelete}
          >
            {t['com.affine.rootAppSidebar.organize.delete']()}
          </MenuItem>
        ),
      },
    ];
  }, [
    handleAddToFolder,
    handleCreateSubfolder,
    handleDelete,
    handleNewDoc,
    node,
    t,
  ]);

  const finalOperations = useMemo(() => {
    if (additionalOperations) {
      return [...additionalOperations, ...folderOperations];
    }
    return folderOperations;
  }, [additionalOperations, folderOperations]);

  const childrenOperations = useCallback(
    (type: string, node: FolderNode) => {
      if (type === 'doc' || type === 'collection' || type === 'tag') {
        return [
          {
            index: 999,
            view: (
              <MenuItem
                type={'danger'}
                prefixIcon={<RiFolderForbidFill size={18} />}
                data-event-props="$.navigationPanel.organize.deleteOrganizeItem"
                data-event-args-type={node.type$.value}
                onClick={() => node.delete()}
              >
                {t['com.affine.rootAppSidebar.organize.delete-from-folder']()}
              </MenuItem>
            ),
          },
        ] satisfies NodeOperation[];
      }
      return [];
    },
    [t]
  );

  const handleCollapsedChange = useCallback(
    (collapsed: boolean) => {
      if (collapsed) {
        setNewFolderId(null); // reset new folder id to clear the renaming state
        setCollapsed(true);
      } else {
        setCollapsed(false);
      }
    },
    [setCollapsed]
  );

  return (
    <NavigationPanelTreeNode
      icon={NavigationPanelFolderIcon}
      name={name}
      dndData={dndData}
      onDrop={handleDropOnFolder}
      defaultRenaming={defaultRenaming}
      renameable
      extractEmojiAsIcon={enableEmojiIcon}
      reorderable={reorderable}
      collapsed={collapsed}
      setCollapsed={handleCollapsedChange}
      onRename={handleRename}
      operations={finalOperations}
      canDrop={handleCanDrop}
      childrenPlaceholder={
        <FolderEmpty canDrop={handleCanDrop} onDrop={handleDropOnPlaceholder} />
      }
      dropEffect={handleDropEffect}
      data-testid={`navigation-panel-folder-${node.id}`}
      explorerIconConfig={node.id ? { where: 'folder', id: node.id } : null}
    >
      {children.map(child => (
        <NavigationPanelFolderNode
          key={child.id}
          nodeId={child.id as string}
          defaultRenaming={child.id === newFolderId}
          onDrop={handleDropOnChildren}
          operations={childrenOperations}
          dropEffect={handleDropEffectOnChildren}
          canDrop={handleChildrenCanDrop}
          location={{
            at: 'navigation-panel:organize:folder-node',
            nodeId: child.id as string,
          }}
          parentPath={path}
        />
      ))}
    </NavigationPanelTreeNode>
  );
};

const NavigationPanelFolderDocIcon: NavigationPanelTreeNodeIcon = ({
  className,
}) => <RiFileTextFill className={className} size={18} />;

const NavigationPanelFolderDocNode = ({
  node,
  docId,
  onDrop,
  location,
  operations: additionalOperations,
  canDrop,
  dropEffect,
  reorderable,
  parentPath,
}: {
  node: FolderNode;
  docId: string;
} & GenericNavigationPanelNode) => {
  const t = useI18n();
  const {
    workspaceService,
    docsService,
    globalContextService,
    featureFlagService,
    workspaceDialogService,
  } = useServices({
    WorkspaceService,
    DocsService,
    GlobalContextService,
    FeatureFlagService,
    WorkspaceDialogService,
  });
  const navigationPanelService = useService(NavigationPanelService);
  const path = useMemo(
    () => [...(parentPath ?? []), `doc-node-${node.id}`],
    [parentPath, node.id]
  );
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => {
      navigationPanelService.setCollapsed(path, value);
    },
    [navigationPanelService, path]
  );

  const active =
    useLiveData(globalContextService.globalContext.docId.$) === docId;
  const docRecord = useLiveData(docsService.list.doc$(docId));
  const docTitle = useLiveData(docRecord?.title$);
  const isInTrash = useLiveData(docRecord?.trash$);
  const enableEmojiIcon = useLiveData(
    featureFlagService.flags.enable_emoji_doc_icon.$
  );
  const children = useLiveData(node.sortedChildren$);
  const { createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );

  const dndData = useMemo(() => {
    return {
      draggable: {
        entity: {
          type: 'doc',
          id: docId,
        },
        from: location,
      },
      dropTarget: {
        at: 'navigation-panel:organize:folder',
      },
    } satisfies AffineDNDData;
  }, [docId, location]);

  const handleRename = useAsyncCallback(
    async (newName: string) => {
      await docsService.changeDocTitle(docId, newName);
      track.$.navigationPanel.organize.renameOrganizeItem({ type: 'doc' });
    },
    [docId, docsService]
  );

  const handleCreateSubPage = useCallback(() => {
    const newDoc = createPage();
    node.createLink('doc', newDoc.id, node.indexAt('after'));
    setCollapsed(false);
    track.$.navigationPanel.folders.createDoc();
    track.$.navigationPanel.organize.createOrganizeItem({
      type: 'link',
      target: 'doc',
    });
  }, [createPage, node, setCollapsed]);

  const handleDropOnDocNode = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (data.treeInstruction?.type === 'make-child') {
        if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
          return;
        }
        if (data.source.data.entity?.type === 'folder') {
          node.moveHere(data.source.data.entity.id, node.indexAt('after'));
          setCollapsed(false);
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'tag'
        ) {
          if (
            data.source.data.entity.type === 'doc' &&
            data.source.data.entity.id === docId
          ) {
            return;
          }
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            node.moveHere(data.source.data.from.nodeId, node.indexAt('after'));
            setCollapsed(false);
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: data.source.data.entity.type,
            });
          } else {
            node.createLink(
              data.source.data.entity.type,
              data.source.data.entity.id,
              node.indexAt('after')
            );
            setCollapsed(false);
            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: data.source.data.entity.type,
            });
          }
        }
      } else {
        onDrop?.(data);
      }
    },
    [docId, node, onDrop, setCollapsed]
  );

  const handleDropEffect = useCallback<NavigationPanelTreeNodeDropEffect>(
    data => {
      if (data.treeInstruction?.type === 'make-child') {
        if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
          return;
        }
        if (
          data.source.data.entity?.type === 'doc' &&
          data.source.data.entity.id === docId
        ) {
          return;
        }
        if (
          data.source.data.entity?.type === 'folder' ||
          data.source.data.from?.at === 'navigation-panel:organize:folder-node'
        ) {
          return 'move';
        }
        if (
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'tag'
        ) {
          return 'link';
        }
      } else {
        return dropEffect?.(data);
      }
      return;
    },
    [docId, dropEffect, node]
  );

  const handleDropOnPlaceholder = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
        return;
      }
      if (data.source.data.entity?.type === 'folder') {
        node.moveHere(data.source.data.entity.id, node.indexAt('after'));
        track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
      } else if (
        data.source.data.entity?.type === 'doc' ||
        data.source.data.entity?.type === 'collection' ||
        data.source.data.entity?.type === 'tag'
      ) {
        if (
          data.source.data.entity.type === 'doc' &&
          data.source.data.entity.id === docId
        ) {
          return;
        }
        if (
          data.source.data.from?.at === 'navigation-panel:organize:folder-node'
        ) {
          node.moveHere(data.source.data.from.nodeId, node.indexAt('after'));
          track.$.navigationPanel.organize.moveOrganizeItem({
            type: 'link',
            target: data.source.data.entity.type,
          });
        } else {
          node.createLink(
            data.source.data.entity.type,
            data.source.data.entity.id,
            node.indexAt('after')
          );
          track.$.navigationPanel.organize.createOrganizeItem({
            type: 'link',
            target: data.source.data.entity.type,
          });
        }
      }
    },
    [docId, node]
  );

  const handleDropOnChildren = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>, dropAtNode?: FolderNode) => {
      if (!dropAtNode || !dropAtNode.id) {
        return;
      }
      if (
        data.treeInstruction?.type === 'reorder-above' ||
        data.treeInstruction?.type === 'reorder-below'
      ) {
        if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
          return;
        }
        const at =
          data.treeInstruction.type === 'reorder-below' ? 'after' : 'before';
        if (data.source.data.entity?.type === 'folder') {
          node.moveHere(
            data.source.data.entity.id,
            node.indexAt(at, dropAtNode.id)
          );
          track.$.navigationPanel.organize.moveOrganizeItem({ type: 'folder' });
        } else if (
          data.source.data.entity?.type === 'doc' ||
          data.source.data.entity?.type === 'collection' ||
          data.source.data.entity?.type === 'tag'
        ) {
          if (
            data.source.data.entity.type === 'doc' &&
            data.source.data.entity.id === docId
          ) {
            return;
          }
          if (
            data.source.data.from?.at ===
            'navigation-panel:organize:folder-node'
          ) {
            node.moveHere(
              data.source.data.from.nodeId,
              node.indexAt(at, dropAtNode.id)
            );
            track.$.navigationPanel.organize.moveOrganizeItem({
              type: 'link',
              target: data.source.data.entity.type,
            });
          } else {
            node.createLink(
              data.source.data.entity.type,
              data.source.data.entity.id,
              node.indexAt(at, dropAtNode.id)
            );
            track.$.navigationPanel.organize.createOrganizeItem({
              type: 'link',
              target: data.source.data.entity.type,
            });
          }
        }
      } else if (data.treeInstruction?.type === 'reparent') {
        const currentLevel = data.treeInstruction.currentLevel;
        const desiredLevel = data.treeInstruction.desiredLevel;
        if (currentLevel === desiredLevel + 1) {
          onDrop?.({
            ...data,
            treeInstruction: {
              type: 'reorder-below',
              currentLevel,
              indentPerLevel: data.treeInstruction.indentPerLevel,
            },
          });
          return;
        }
        onDrop?.({
          ...data,
          treeInstruction: {
            ...data.treeInstruction,
            currentLevel: currentLevel - 1,
          },
        });
      }
    },
    [docId, node, onDrop]
  );

  const handleDropEffectOnChildren =
    useCallback<NavigationPanelTreeNodeDropEffect>(
      data => {
        if (
          data.treeInstruction?.type === 'reorder-above' ||
          data.treeInstruction?.type === 'reorder-below'
        ) {
          if (isInvalidSelfOrAncestorDrop(node, data.source.data)) {
            return;
          }
          if (
            data.source.data.entity?.type === 'doc' &&
            data.source.data.entity.id === docId
          ) {
            return;
          }
          if (
            data.source.data.entity?.type === 'folder' ||
            data.source.data.from?.at ===
              'navigation-panel:organize:folder-node'
          ) {
            return 'move';
          }
          if (
            data.source.data.entity?.type === 'doc' ||
            data.source.data.entity?.type === 'collection' ||
            data.source.data.entity?.type === 'tag'
          ) {
            return 'link';
          }
        } else if (data.treeInstruction?.type === 'reparent') {
          const currentLevel = data.treeInstruction.currentLevel;
          const desiredLevel = data.treeInstruction.desiredLevel;
          if (currentLevel === desiredLevel + 1) {
            dropEffect?.({
              ...data,
              treeInstruction: {
                type: 'reorder-below',
                currentLevel,
                indentPerLevel: data.treeInstruction.indentPerLevel,
              },
            });
            return;
          }
          dropEffect?.({
            ...data,
            treeInstruction: {
              ...data.treeInstruction,
              currentLevel: currentLevel - 1,
            },
          });
        }
        return;
      },
      [docId, dropEffect, node]
    );

  const handleCanDrop = useMemo<DropTargetOptions<AffineDNDData>['canDrop']>(
    () => args => {
      const entityType = args.source.data.entity?.type;
      if (args.treeInstruction && args.treeInstruction.type !== 'make-child') {
        return (
          (typeof canDrop === 'function' ? canDrop(args) : canDrop) ?? true
        );
      }
      if (isInvalidSelfOrAncestorDrop(node, args.source.data)) {
        return false;
      }
      if (entityType === 'doc' && args.source.data.entity?.id === docId) {
        return false;
      }
      return (
        entityType === 'folder' ||
        entityType === 'doc' ||
        entityType === 'collection' ||
        entityType === 'tag'
      );
    },
    [canDrop, docId, node]
  );

  const handleChildrenCanDrop = useMemo<
    DropTargetOptions<AffineDNDData>['canDrop']
  >(
    () => args => {
      const entityType = args.source.data.entity?.type;
      if (isInvalidSelfOrAncestorDrop(node, args.source.data)) {
        return false;
      }
      if (entityType === 'doc' && args.source.data.entity?.id === docId) {
        return false;
      }
      return (
        entityType === 'folder' ||
        entityType === 'doc' ||
        entityType === 'collection' ||
        entityType === 'tag'
      );
    },
    [docId, node]
  );

  const baseDocOperations = useNavigationPanelDocNodeOperations(
    docId,
    useMemo(
      () => ({
        openInfoModal: () => workspaceDialogService.open('doc-info', { docId }),
        openNodeCollapsed: () => setCollapsed(false),
      }),
      [docId, setCollapsed, workspaceDialogService]
    )
  );

  const finalOperations = useMemo(() => {
    const subPageOps: NodeOperation[] = [
      {
        index: 0,
        inline: true,
        view: (
          <IconButton
            size="16"
            data-testid={`navigation-panel-doc-add-subpage-${docId}`}
            onClick={handleCreateSubPage}
            tooltip="Add sub-page"
          >
            <RiAddFill size={16} />
          </IconButton>
        ),
      },
      {
        index: 98,
        view: (
          <MenuItem
            prefixIcon={<RiFileAddFill size={18} />}
            onClick={handleCreateSubPage}
          >
            Add sub-page
          </MenuItem>
        ),
      },
    ];
    const filteredBase = baseDocOperations.filter(op => !op.inline);
    return [...subPageOps, ...filteredBase, ...(additionalOperations ?? [])];
  }, [additionalOperations, baseDocOperations, docId, handleCreateSubPage]);

  const childrenOperations = useCallback(
    (type: string, childNode: FolderNode) => {
      if (type === 'doc' || type === 'collection' || type === 'tag') {
        return [
          {
            index: 999,
            view: (
              <MenuItem
                type={'danger'}
                prefixIcon={<RiFolderForbidFill size={18} />}
                data-event-props="$.navigationPanel.organize.deleteOrganizeItem"
                data-event-args-type={childNode.type$.value}
                onClick={() => childNode.delete()}
              >
                {t['com.affine.rootAppSidebar.organize.delete-from-folder']()}
              </MenuItem>
            ),
          },
        ] satisfies NodeOperation[];
      }
      return [];
    },
    [t]
  );

  if (isInTrash || !docRecord) {
    return null;
  }

  return (
    <NavigationPanelTreeNode
      icon={NavigationPanelFolderDocIcon}
      name={docTitle}
      dndData={dndData}
      onDrop={handleDropOnDocNode}
      renameable
      extractEmojiAsIcon={enableEmojiIcon}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      collapsible
      canDrop={handleCanDrop}
      to={`/${docId}`}
      onClick={() => {
        track.$.navigationPanel.docs.openDoc();
      }}
      active={active}
      reorderable={reorderable}
      renameableGuard={{
        docId,
        action: 'Doc_Update',
      }}
      onRename={handleRename}
      childrenPlaceholder={
        <FolderEmpty canDrop={handleCanDrop} onDrop={handleDropOnPlaceholder} />
      }
      operations={finalOperations}
      dropEffect={handleDropEffect}
      data-testid={`navigation-panel-doc-${docId}`}
      explorerIconConfig={{
        where: 'doc',
        id: docId,
      }}
    >
      {children.map(child => (
        <NavigationPanelFolderNode
          key={child.id}
          nodeId={child.id as string}
          onDrop={handleDropOnChildren}
          operations={childrenOperations}
          dropEffect={handleDropEffectOnChildren}
          canDrop={handleChildrenCanDrop}
          location={{
            at: 'navigation-panel:organize:folder-node',
            nodeId: child.id as string,
          }}
          parentPath={path}
        />
      ))}
    </NavigationPanelTreeNode>
  );
};
