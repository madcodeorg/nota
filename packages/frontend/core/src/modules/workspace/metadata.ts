export type WorkspaceMetadata = {
  id: string;
  flavour: string;
  initialized?: boolean;
};

/**
 * Workspace flavours whose data is owned directly by the user instead of a
 * Nota/self-hosted workspace server.
 *
 * Google Drive workspaces use the same local SQLite/IndexedDB source of truth
 * as local workspaces and sync to the user's own Drive account. They must not
 * be routed through server sharing, membership, quota, or access-token flows.
 */
export const isUserOwnedWorkspaceFlavour = (flavour: string) =>
  flavour === 'local' || flavour === 'google-drive';

export const isServerBackedWorkspaceFlavour = (flavour: string) =>
  !isUserOwnedWorkspaceFlavour(flavour);
