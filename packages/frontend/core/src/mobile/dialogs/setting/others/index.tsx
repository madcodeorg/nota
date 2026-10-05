import { NOTA_LINKS } from '@nota/core/utils/public-links';
import { useI18n } from '@nota/i18n';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';
import { DeleteAccount } from './delete-account';

export const OthersGroup = () => {
  const t = useI18n();

  return (
    <SettingGroup title={t['com.affine.mobile.setting.others.title']()}>
      <RowLayout
        label={t['com.affine.issue-feedback.title']()}
        href={NOTA_LINKS.issues}
      />
      <RowLayout
        label={t['com.affine.mobile.setting.others.github']()}
        href={NOTA_LINKS.source}
      />

      <RowLayout
        label={t['com.affine.mobile.setting.others.website']()}
        href={NOTA_LINKS.source}
      />

      <RowLayout
        label={t['com.affine.mobile.setting.others.privacy']()}
        href={NOTA_LINKS.privacy}
      />

      <RowLayout
        label={t['com.affine.mobile.setting.others.terms']()}
        href={NOTA_LINKS.terms}
      />
      <DeleteAccount />
    </SettingGroup>
  );
};
