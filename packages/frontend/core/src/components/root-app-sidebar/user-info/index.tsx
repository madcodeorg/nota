import {
  Avatar,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  type MenuProps,
  useConfirmModal,
} from '@nota/component';
import {
  type AccountDisplayInfo,
  useAccountDisplay,
} from '@nota/core/components/hooks/use-account-display';
import { GlobalDialogService } from '@nota/core/modules/dialogs';
import {
  GoogleAuthService,
  type GoogleUserInfo,
} from '@nota/core/modules/google-auth';
import { useLiveData, useService } from '@nota/infra';
import { useCallback } from 'react';

import { Account } from './account';
import * as styles from './index.css';
import { UnknownUserIcon } from './unknow-user';

export default function UserInfo({ size = 20 }: { size?: number }) {
  const account = useAccountDisplay();
  return account ? (
    <AuthorizedUserInfo account={account} size={size} />
  ) : (
    <UnauthorizedUserInfo size={size} />
  );
}

const menuContentOptions: MenuProps['contentOptions'] = {
  className: styles.operationMenu,
};
const AuthorizedUserInfo = ({
  account,
  size,
}: {
  account: AccountDisplayInfo;
  size: number;
}) => {
  return (
    <Menu items={<OperationMenu />} contentOptions={menuContentOptions}>
      <IconButton
        data-testid="sidebar-user-avatar"
        variant="plain"
        size="20"
        style={{ padding: 0, width: size, height: size }}
        withoutHover
      >
        <Avatar size={size} name={account.name} url={account.avatar} />
      </IconButton>
    </Menu>
  );
};

const UnauthorizedUserInfo = ({ size }: { size: number }) => {
  const globalDialogService = useService(GlobalDialogService);

  const openSignInModal = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <IconButton
      onClick={openSignInModal}
      data-testid="sidebar-user-avatar"
      variant="plain"
      size="20"
      style={{ width: size, height: size }}
    >
      <UnknownUserIcon />
    </IconButton>
  );
};

const GoogleDriveMenuItem = () => {
  const googleAuthService = useService(GoogleAuthService);
  const { openConfirmModal } = useConfirmModal();
  const status = useLiveData(googleAuthService.session.status$);
  const userInfo = useLiveData(
    googleAuthService.session.userInfo$
  ) as GoogleUserInfo | null;

  const handleConnect = useCallback(() => {
    googleAuthService.connect().catch((err: unknown) => {
      console.error('[GoogleDriveMenuItem] connect failed', err);
    });
  }, [googleAuthService]);

  const handleDisconnect = useCallback(() => {
    openConfirmModal({
      title: 'Disconnect Google?',
      children:
        'This disconnects both Google Drive and Google Calendar on this device. Your local Nota notes stay available.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      confirmButtonOptions: { variant: 'error' },
      onConfirm: () => googleAuthService.disconnect(),
    });
  }, [googleAuthService, openConfirmModal]);

  if (status === 'connected' && userInfo) {
    return (
      <>
        <MenuItem data-testid="sidebar-google-drive-connected" disabled>
          Google Drive &amp; Calendar: {userInfo.email}
        </MenuItem>
        <MenuItem
          data-testid="sidebar-google-drive-disconnect"
          onClick={handleDisconnect}
        >
          Disconnect Google
        </MenuItem>
      </>
    );
  }

  return (
    <MenuItem
      data-testid="sidebar-google-drive-connect"
      onClick={handleConnect}
      disabled={status === 'connecting'}
    >
      {status === 'connecting'
        ? 'Connecting…'
        : 'Connect Google Drive & Calendar'}
    </MenuItem>
  );
};

const OperationMenu = () => {
  return (
    <>
      <Account />
      <Divider />
      <GoogleDriveMenuItem />
    </>
  );
};
