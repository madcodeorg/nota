import type { WorkspaceMetadata } from '../../workspace';

/**
 * Disabled: quota checks not applicable to Nota local workspaces.
 */
export const QuotaCheck = (_props: { workspaceMeta: WorkspaceMetadata }) => {
  return null;
};
