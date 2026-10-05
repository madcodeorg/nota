import { SettingsIcon } from '@blocksuite/icons/rc';
import type { I18n } from '@nota/core/modules/i18n';
import type { useI18n } from '@nota/i18n';
import { track } from '@nota/track';

import { registerAffineCommand } from './registry';

export function registerAffineLanguageCommands({
  i18n,
  t,
}: {
  i18n: I18n;
  t: ReturnType<typeof useI18n>;
}) {
  // Display Language
  const disposables = i18n.languageList.map(language => {
    return registerAffineCommand({
      id: `affine:change-display-language-to-${language.name}`,
      label: `${t['com.affine.cmdk.affine.display-language.to']()} ${
        language.originalName
      }`,
      category: 'nota:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () =>
        i18n.currentLanguage$.value.key !== language.key,
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'language',
          value: language.name,
        });

        i18n.changeLanguage(language.key);
      },
    });
  });

  return () => {
    disposables.forEach(dispose => dispose());
  };
}
