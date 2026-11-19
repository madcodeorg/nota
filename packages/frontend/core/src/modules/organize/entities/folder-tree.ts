import {
  Entity,
  generateFractionalIndexingKeyBetween,
  LiveData,
} from '@nota/infra';
import { map } from 'rxjs';

import { buildDocAncestors, type FolderStore } from '../stores/folder';
import type { OrganizeBreadcrumbItem } from '../types';
import { FolderNode } from './folder-node';

export class FolderTree extends Entity {
  constructor(private readonly folderStore: FolderStore) {
    super();
  }

  readonly rootFolder = this.framework.createEntity(FolderNode, {
    id: null,
  });

  isLoading$ = this.folderStore.watchIsLoading();

  // get folder by id
  folderNode$(id: string) {
    return LiveData.from(
      this.folderStore.watchNodeInfo(id).pipe(
        map(info => {
          if (!info) {
            return null;
          }
          return this.framework.createEntity(FolderNode, {
            id,
          });
        })
      ),
      null
    );
  }

  ancestorsForDoc$(docId: string) {
    return LiveData.from<OrganizeBreadcrumbItem[]>(
      this.folderStore
        .watchAllNodes()
        .pipe(map(nodes => buildDocAncestors(nodes, docId))),
      []
    );
  }

  findDocNodeId(docId: string) {
    return this.folderStore.findDocNodeId(docId);
  }

  navigationPathForNode(nodeId: string) {
    return this.folderStore.getNavigationPath(nodeId);
  }

  addSubPage(parentDocId: string, childDocId: string) {
    if (!parentDocId || !childDocId || parentDocId === childDocId) {
      throw new Error('Sub-page must reference a distinct parent page');
    }
    const existingParentNodeId = this.folderStore.findDocNodeId(parentDocId);
    const parentNodeId =
      existingParentNodeId ??
      this.folderStore.createLink(
        null,
        'doc',
        parentDocId,
        generateFractionalIndexingKeyBetween(
          this.folderStore.getLastChildIndex(null),
          null
        )
      );
    const nextIndex = generateFractionalIndexingKeyBetween(
      this.folderStore.getLastChildIndex(parentNodeId),
      null
    );
    return this.folderStore.createLink(
      parentNodeId,
      'doc',
      childDocId,
      nextIndex
    );
  }
}
