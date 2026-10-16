import { useI18n } from '@nota/i18n';
import { useMemo } from 'react';

export const useNavConfig = () => {
  const t = useI18n();
  return useMemo(
    () => [
      {
        title: t['com.affine.other-page.nav.official-website'](),
        path: 'https://thenota.app',
      },
      {
        title: t['com.affine.other-page.nav.contact-us'](),
        path: 'https://github.com/madcodeorg/nota/issues',
      },
    ],
    [t]
  );
};
