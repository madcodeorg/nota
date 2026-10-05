import { NotificationCenter } from '@nota/component';
import { DefaultServerService } from '@nota/core/modules/cloud';
import { FrameworkScope, useService } from '@nota/infra';
import { Outlet } from 'react-router-dom';

import { GlobalDialogs } from '../../dialogs';
import { CustomThemeModifier } from './custom-theme';
import { FindInPagePopup } from './find-in-page/find-in-page-popup';

export const RootWrapper = () => {
  // No Nota Cloud server — the seeded server config is authoritative, so there
  // is nothing to revalidate at launch (previously this spammed /graphql).
  const defaultServerService = useService(DefaultServerService);

  return (
    <FrameworkScope scope={defaultServerService.server.scope}>
      <GlobalDialogs />
      <NotificationCenter />
      <Outlet />
      <CustomThemeModifier />
      {BUILD_CONFIG.isElectron && <FindInPagePopup />}
    </FrameworkScope>
  );
};
