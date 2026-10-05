import { useI18n } from '@nota/i18n';
import { useMemo } from 'react';

export const useNavConfig = () => {
  const t = useI18n();
  return useMemo(
    () => [
      {
        title: t['com.affine.other-page.nav.official-website'](),
        path: 'https://nota.pro',
      },
      {
        title: t['com.affine.other-page.nav.blog'](),
        path: 'https://nota.pro/blog',
      },
      {
        title: t['com.affine.other-page.nav.contact-us'](),
        path: 'https://nota.pro/about-us',
      },
    ],
    [t]
  );
};
