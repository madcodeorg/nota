import type { Workspace } from '@nota/core/modules/workspace';

export interface PublishPanelProps {
  workspace: Workspace | null;
}

// Enable-cloud panel disabled — EE backend removed
export const EnableCloudPanel = ({
  onCloseSetting: _onCloseSetting,
}: {
  onCloseSetting?: () => void;
}) => {
  return null;
};
