export interface NodeInfo {
  id: string;
  parentId: string | null;
  type: 'folder' | 'doc' | 'tag' | 'collection';
  data: string;
  index: string;
}

export type OrganizeBreadcrumbItem =
  | { nodeId: string; type: 'folder'; name: string }
  | { nodeId: string; type: 'doc'; docId: string };
