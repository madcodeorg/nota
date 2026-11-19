import { Store } from '@nota/infra';

import type { WorkspaceDBService } from '../../db';
import type { OrganizeBreadcrumbItem } from '../types';

export interface StoredFolderNode {
  id: string;
  parentId?: string | null;
  type: string;
  data: string;
  index: string;
}

export function isContainerNodeType(type: string): boolean {
  return type === 'folder' || type === 'doc';
}

export function buildDocAncestors(
  nodes: ReadonlyArray<StoredFolderNode>,
  docId: string
): OrganizeBreadcrumbItem[] {
  const byId = new Map<string, StoredFolderNode>();
  const matches: StoredFolderNode[] = [];
  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.type === 'doc' && node.data === docId) {
      matches.push(node);
    }
  }
  if (!matches.length) {
    return [];
  }

  matches.sort((a, b) => a.id.localeCompare(b.id));

  let best: OrganizeBreadcrumbItem[] = [];
  for (const match of matches) {
    const chain: OrganizeBreadcrumbItem[] = [];
    const visited = new Set<string>([match.id]);
    let currentParentId = match.parentId ?? null;
    while (currentParentId) {
      if (visited.has(currentParentId)) {
        break;
      }
      const parent = byId.get(currentParentId);
      if (!parent) {
        break;
      }
      visited.add(parent.id);
      if (parent.type === 'folder') {
        chain.push({
          nodeId: parent.id,
          type: 'folder',
          name: parent.data,
        });
      } else if (parent.type === 'doc') {
        chain.push({
          nodeId: parent.id,
          type: 'doc',
          docId: parent.data,
        });
      } else {
        break;
      }
      currentParentId = parent.parentId ?? null;
    }
    chain.reverse();
    if (chain.length > best.length) {
      best = chain;
    }
  }

  return best;
}

export class FolderStore extends Store {
  constructor(private readonly dbService: WorkspaceDBService) {
    super();
  }

  watchNodeInfo(nodeId: string) {
    return this.dbService.db.folders.get$(nodeId);
  }

  watchNodeChildren(parentId: string | null) {
    return this.dbService.db.folders.find$({
      parentId: parentId,
    });
  }

  watchAllNodes() {
    return this.dbService.db.folders.find$();
  }

  watchIsLoading() {
    return this.dbService.db.folders.isLoading$;
  }

  findDocNodeId(docId: string): string | null {
    const matches = this.dbService.db.folders
      .find({
        type: 'doc',
        data: docId,
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const nested = matches.find(node => !!node.parentId);
    return (nested ?? matches[0])?.id ?? null;
  }

  getNavigationPath(nodeId: string): string[] {
    const segments: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = nodeId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const info = this.dbService.db.folders.get(currentId);
      if (!info) {
        break;
      }
      if (info.type === 'folder') {
        segments.push(`folder-${info.id}`);
      } else if (info.type === 'doc') {
        segments.push(`doc-node-${info.id}`);
      } else {
        break;
      }
      currentId = info.parentId ?? null;
    }
    segments.reverse();
    return ['organize', ...segments];
  }

  getLastChildIndex(parentId: string | null): string | null {
    const children = this.dbService.db.folders
      .find({
        parentId,
      })
      .sort((a, b) => (a.index > b.index ? 1 : a.index < b.index ? -1 : 0));
    return children.at(-1)?.index ?? null;
  }

  isAncestor(childId: string, ancestorId: string): boolean {
    if (childId === ancestorId) {
      return false;
    }
    const history = new Set<string>([childId]);
    let current: string = childId;
    while (current) {
      const info = this.dbService.db.folders.get(current);
      if (info === null || !info.parentId) {
        return false;
      }
      current = info.parentId;
      if (history.has(current)) {
        return false; // loop detected
      }
      history.add(current);
      if (current === ancestorId) {
        return true;
      }
    }
    return false;
  }

  createLink(
    parentId: string | null,
    type: 'doc' | 'tag' | 'collection',
    nodeId: string,
    index: string
  ) {
    if (parentId === null) {
      if (type !== 'doc') {
        throw new Error('Root node can only have folders or pages');
      }
    } else {
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || !isContainerNodeType(parent.type)) {
        throw new Error('Parent folder or page not found');
      }
    }

    return this.dbService.db.folders.create({
      parentId,
      type,
      data: nodeId,
      index: index,
    }).id;
  }

  renameNode(nodeId: string, name: string) {
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }
    if (node.type !== 'folder') {
      throw new Error('Cannot rename non-folder node');
    }
    this.dbService.db.folders.update(nodeId, {
      data: name,
    });
  }

  createFolder(parentId: string | null, name: string, index: string) {
    if (parentId) {
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || !isContainerNodeType(parent.type)) {
        throw new Error('Parent folder or page not found');
      }
    }

    return this.dbService.db.folders.create({
      parentId: parentId,
      type: 'folder',
      data: name,
      index: index,
    }).id;
  }

  private removeNodeSubtree(rootInfo: StoredFolderNode) {
    const stack: StoredFolderNode[] = [rootInfo];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);
      if (isContainerNodeType(current.type)) {
        const children = this.dbService.db.folders.find({
          parentId: current.id,
        });
        stack.push(...children);
      }
      this.dbService.db.folders.delete(current.id);
    }
  }

  removeFolder(folderId: string) {
    const info = this.dbService.db.folders.get(folderId);
    if (info === null || info.type !== 'folder') {
      throw new Error('Folder not found');
    }
    this.removeNodeSubtree(info);
  }

  removeLink(linkId: string) {
    const link = this.dbService.db.folders.get(linkId);
    if (link === null || link.type === 'folder') {
      throw new Error('Link not found');
    }
    this.removeNodeSubtree(link);
  }

  moveNode(nodeId: string, parentId: string | null, index: string) {
    const node = this.dbService.db.folders.get(nodeId);
    if (node === null) {
      throw new Error('Node not found');
    }

    if (parentId) {
      if (nodeId === parentId) {
        throw new Error('Cannot move a node to itself');
      }
      if (this.isAncestor(parentId, nodeId)) {
        throw new Error('Cannot move a node to its descendant');
      }
      const parent = this.dbService.db.folders.get(parentId);
      if (parent === null || !isContainerNodeType(parent.type)) {
        throw new Error('Parent folder or page not found');
      }
    } else {
      if (!isContainerNodeType(node.type)) {
        throw new Error('Root node can only have folders or pages');
      }
    }
    this.dbService.db.folders.update(nodeId, {
      parentId,
      index,
    });
  }
}
