import { NotificationCenter } from '@nota/component';
import { DefaultServerService } from '@nota/core/modules/cloud';
import { FrameworkScope, useService } from '@nota/infra';
import { Outlet } from 'react-router-dom';

import { GlobalDialogs } from '../../dialogs';

export const RootWrapper = () => {
  // No Nota Cloud server — nothing to revalidate at launch.
  const defaultServerService = useService(DefaultServerService);

  return (
    <FrameworkScope scope={defaultServerService.server.scope}>
      <GlobalDialogs />
      <NotificationCenter />
      <Outlet />
    </FrameworkScope>
  );
};
