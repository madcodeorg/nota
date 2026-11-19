import { Framework } from '@nota/infra';
import { BehaviorSubject, map, type Observable } from 'rxjs';
import { describe, expect, test } from 'vitest';

import { WorkspaceDBService } from '../../db';
import { FolderNode } from '../entities/folder-node';
import { FolderTree } from '../entities/folder-tree';
import { OrganizeService } from '../services/organize';
import {
  buildDocAncestors,
  FolderStore,
  isContainerNodeType,
  type StoredFolderNode,
} from '../stores/folder';

function createOrganizeFixture() {
  let seq = 0;
  const rows$ = new BehaviorSubject<StoredFolderNode[]>([]);
  const filterRows = (
    rows: StoredFolderNode[],
    where?: Record<string, unknown>
  ) => {
    if (!where) return [...rows];
    return rows.filter(row =>
      Object.entries(where).every(([key, value]) => {
        if (value === undefined) return true;
        const actual = (row as unknown as Record<string, unknown>)[key] ?? null;
        return actual === (value ?? null);
      })
    );
  };

  const foldersTable = {
    isLoading$: new BehaviorSubject(false),
    get(id: string) {
      return rows$.value.find(row => row.id === id) ?? null;
    },
    // eslint-disable-next-line rxjs/finnish -- mirrors Table.get$ ORM method
    get$(id: string): Observable<StoredFolderNode | null> {
      return rows$.pipe(map(rows => rows.find(row => row.id === id) ?? null));
    },
    find(where?: Record<string, unknown>) {
      return filterRows(rows$.value, where);
    },
    // eslint-disable-next-line rxjs/finnish -- mirrors Table.find$ ORM method
    find$(where?: Record<string, unknown>): Observable<StoredFolderNode[]> {
      return rows$.pipe(map(rows => filterRows(rows, where)));
    },
    create(input: Omit<StoredFolderNode, 'id'>) {
      const created: StoredFolderNode = {
        id: `node-${++seq}`,
        parentId: input.parentId ?? null,
        type: input.type,
        data: input.data,
        index: input.index,
      };
      rows$.next([...rows$.value, created]);
      return created;
    },
    update(id: string, patch: Partial<StoredFolderNode>) {
      const next = rows$.value.map(row =>
        row.id === id ? { ...row, ...patch } : row
      );
      rows$.next(next);
      return next.find(row => row.id === id) ?? null;
    },
    delete(id: string) {
      rows$.next(rows$.value.filter(row => row.id !== id));
    },
  };

  const framework = new Framework();
  framework
    .service(WorkspaceDBService, { db: { folders: foldersTable } } as any)
    .service(OrganizeService)
    .entity(FolderTree, [FolderStore])
    .entity(FolderNode, [FolderStore])
    .store(FolderStore, [WorkspaceDBService]);

  const provider = framework.provider();
  const store = provider.get(FolderStore);
  const organize = provider.get(OrganizeService);

  return { store, tree: organize.folderTree, rows$ };
}

describe('FolderStore and FolderTree nested sub-pages', () => {
  test('allows pages at root and nested sub-pages inside pages and folders', () => {
    const { store, tree } = createOrganizeFixture();
    const folderId = store.createFolder(null, 'Product', 'a0');
    const rootDocNodeId = store.createLink(null, 'doc', 'doc-home', 'a1');
    const childDocNodeId = store.createLink(
      rootDocNodeId,
      'doc',
      'doc-roadmap',
      'a0'
    );
    store.createLink(childDocNodeId, 'doc', 'doc-q4', 'a0');
    store.createLink(folderId, 'doc', 'doc-spec', 'a0');

    expect(isContainerNodeType('folder')).toBe(true);
    expect(isContainerNodeType('doc')).toBe(true);
    expect(isContainerNodeType('tag')).toBe(false);

    const q4Ancestors: unknown[] = [];
    const sub = tree.ancestorsForDoc$('doc-q4').subscribe(v => {
      q4Ancestors.push(v);
    });
    expect(q4Ancestors.at(-1)).toEqual([
      { nodeId: rootDocNodeId, type: 'doc', docId: 'doc-home' },
      { nodeId: childDocNodeId, type: 'doc', docId: 'doc-roadmap' },
    ]);

    // Reactive update when moving roadmap inside Product folder.
    store.moveNode(childDocNodeId, folderId, 'a1');
    expect(q4Ancestors.at(-1)).toEqual([
      { nodeId: folderId, type: 'folder', name: 'Product' },
      { nodeId: childDocNodeId, type: 'doc', docId: 'doc-roadmap' },
    ]);
    sub.unsubscribe();
  });

  test('addSubPage creates root parent when missing and appends sequential sub-pages', () => {
    const { tree, rows$ } = createOrganizeFixture();
    const sub1 = tree.addSubPage('doc-parent', 'doc-sub-1');
    const sub2 = tree.addSubPage('doc-parent', 'doc-sub-2');

    const parentNodeId = tree.findDocNodeId('doc-parent');
    expect(parentNodeId).toBeTruthy();
    const children = rows$.value.filter(row => row.parentId === parentNodeId);
    expect(children.map(c => c.id)).toEqual([sub1, sub2]);
    expect(children[0].index < children[1].index).toBe(true);
    expect(() => tree.addSubPage('doc-parent', 'doc-parent')).toThrow();
  });

  test('rejects non-doc links at root and prevents ancestor cycles when moving pages', () => {
    const { store } = createOrganizeFixture();
    expect(() => store.createLink(null, 'tag', 'tag-1', 'a0')).toThrow();
    expect(() => store.createLink(null, 'collection', 'col-1', 'a0')).toThrow();

    const parentNodeId = store.createLink(null, 'doc', 'doc-parent', 'a0');
    const childNodeId = store.createLink(
      parentNodeId,
      'doc',
      'doc-child',
      'a0'
    );
    const leafNodeId = store.createLink(childNodeId, 'doc', 'doc-leaf', 'a0');

    expect(() => store.moveNode(parentNodeId, parentNodeId, 'a0')).toThrow(
      'Cannot move a node to itself'
    );
    expect(() => store.moveNode(parentNodeId, leafNodeId, 'a0')).toThrow(
      'Cannot move a node to its descendant'
    );

    // Moving a nested page out to root is allowed.
    store.moveNode(leafNodeId, null, 'a1');
    expect(store.isAncestor(leafNodeId, parentNodeId)).toBe(false);
  });

  test('recursively removes nested child links when removing a page node from the tree', () => {
    const { store, rows$ } = createOrganizeFixture();
    const rootDoc = store.createLink(null, 'doc', 'doc-a', 'a0');
    const subDoc = store.createLink(rootDoc, 'doc', 'doc-b', 'a0');
    store.createLink(subDoc, 'doc', 'doc-c', 'a0');
    const siblingFolder = store.createFolder(null, 'Keep', 'a1');

    store.removeLink(rootDoc);

    expect(rows$.value.map(row => row.id)).toEqual([siblingFolder]);
  });

  test('tracks deterministic last child index and prefers nested doc node lookup', () => {
    const { store } = createOrganizeFixture();
    const rootDoc = store.createLink(null, 'doc', 'doc-shared', 'a0');
    const folder = store.createFolder(null, 'Docs', 'a1');
    const nestedDoc = store.createLink(folder, 'doc', 'doc-shared', 'a0');
    store.createLink(folder, 'doc', 'doc-other', 'a2');

    expect(store.findDocNodeId('doc-shared')).toBe(nestedDoc);
    expect(store.getLastChildIndex(folder)).toBe('a2');
    expect(rootDoc).not.toBe(nestedDoc);
  });
});

describe('buildDocAncestors', () => {
  test('prefers the deepest ancestor chain and guards against corrupted cycles', () => {
    const nodes: StoredFolderNode[] = [
      {
        id: 'f1',
        parentId: null,
        type: 'folder',
        data: 'Projects',
        index: 'a0',
      },
      { id: 'd1', parentId: 'f1', type: 'doc', data: 'alpha', index: 'a0' },
      { id: 'd2', parentId: 'd1', type: 'doc', data: 'beta', index: 'a0' },
      { id: 'd2-root', parentId: null, type: 'doc', data: 'beta', index: 'a1' },
      // Corrupted cycle
      { id: 'c1', parentId: 'c2', type: 'doc', data: 'loop-a', index: 'a0' },
      { id: 'c2', parentId: 'c1', type: 'doc', data: 'loop-b', index: 'a0' },
    ];

    expect(buildDocAncestors(nodes, 'beta')).toEqual([
      { nodeId: 'f1', type: 'folder', name: 'Projects' },
      { nodeId: 'd1', type: 'doc', docId: 'alpha' },
    ]);

    expect(buildDocAncestors(nodes, 'loop-a')).toEqual([
      { nodeId: 'c2', type: 'doc', docId: 'loop-b' },
    ]);
  });
});
