import { useI18n } from '@nota/i18n';
import { RiPriceTag3Fill } from 'react-icons/ri';

import { NavigationPanelEmptySection } from '../../layouts/empty-section';

export const RootEmpty = () => {
  const t = useI18n();

  return (
    <NavigationPanelEmptySection
      icon={<RiPriceTag3Fill />}
      message={t['com.affine.rootAppSidebar.tags.empty']()}
      messageTestId="slider-bar-tags-empty-message"
    />
  );
};
