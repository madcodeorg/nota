import { FlexWrapper } from '@nota/component';
import { ExplorerDisplayMenuButton } from '@nota/core/components/explorer/display-menu';
import { ViewToggle } from '@nota/core/components/explorer/display-menu/view-toggle';
import { ExplorerNavigation } from '@nota/core/components/explorer/header/navigation';
import type { ExplorerDisplayPreference } from '@nota/core/components/explorer/types';
import { Header } from '@nota/core/components/pure/header';

export const CollectionDetailHeader = ({
  displayPreference,
  onDisplayPreferenceChange,
}: {
  displayPreference: ExplorerDisplayPreference;
  onDisplayPreferenceChange: (
    displayPreference: ExplorerDisplayPreference
  ) => void;
}) => {
  return (
    <Header
      right={
        <FlexWrapper gap={16}>
          <ViewToggle
            view={displayPreference.view ?? 'list'}
            onViewChange={view => {
              onDisplayPreferenceChange({ ...displayPreference, view });
            }}
          />
          <ExplorerDisplayMenuButton
            displayPreference={displayPreference}
            onDisplayPreferenceChange={onDisplayPreferenceChange}
          />
        </FlexWrapper>
      }
      left={<ExplorerNavigation active="collections" />}
    />
  );
};
