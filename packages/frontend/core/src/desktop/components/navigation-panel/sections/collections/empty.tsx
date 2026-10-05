import { useI18n } from '@nota/i18n';
import { RiArchiveStackFill } from 'react-icons/ri';

import { NavigationPanelEmptySection } from '../../layouts/empty-section';

export const RootEmpty = ({
  onClickCreate,
}: {
  onClickCreate?: () => void;
}) => {
  const t = useI18n();

  return (
    <NavigationPanelEmptySection
      icon={<RiArchiveStackFill />}
      message={t['com.affine.collections.empty.message']()}
      messageTestId="slider-bar-collection-empty-message"
      actionText={t['com.affine.collections.empty.new-collection-button']()}
      onActionClick={onClickCreate}
    />
  );
};
