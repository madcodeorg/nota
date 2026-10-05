import { Menu, MenuItem, MenuTrigger } from '@nota/component';
import { OpenInAppService, OpenLinkMode } from '@nota/core/modules/open-in-app';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { useMemo } from 'react';

import * as styles from './links.css';

export const OpenInAppLinksMenu = () => {
  const t = useI18n();
  const openInAppService = useService(OpenInAppService);
  const currentOpenInAppMode = useLiveData(openInAppService.openLinkMode$);

  const options = useMemo(
    () =>
      Object.values(OpenLinkMode).map(mode => ({
        label:
          t.t(`com.affine.setting.appearance.open-in-app.${mode}`) ||
          `com.affine.setting.appearance.open-in-app.${mode}`,
        value: mode,
      })),
    [t]
  );

  return (
    <Menu
      items={options.map(option => {
        return (
          <MenuItem
            key={option.value}
            title={option.label}
            onSelect={() => openInAppService.setOpenLinkMode(option.value)}
            data-selected={currentOpenInAppMode === option.value}
          >
            {option.label}
          </MenuItem>
        );
      })}
      contentOptions={{
        className: styles.menu,
        align: 'end',
      }}
    >
      <MenuTrigger style={{ fontWeight: 600, width: '250px' }} block={true}>
        {options.find(option => option.value === currentOpenInAppMode)?.label}
      </MenuTrigger>
    </Menu>
  );
};
