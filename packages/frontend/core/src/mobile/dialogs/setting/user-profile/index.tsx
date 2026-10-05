import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { Avatar } from '@nota/component';
import {
  type AccountDisplayInfo,
  useAccountDisplay,
} from '@nota/core/components/hooks/use-account-display';
import { GlobalDialogService } from '@nota/core/modules/dialogs';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { useService } from '@nota/infra';
import { type ReactNode } from 'react';

import { SettingGroup } from '../group';
import * as styles from './style.css';

export const UserProfile = () => {
  const account = useAccountDisplay();

  return account ? (
    <AuthorizedUserProfile account={account} />
  ) : (
    <UnauthorizedUserProfile />
  );
};

const BaseLayout = ({
  avatar,
  title,
  caption,
  onClick,
}: {
  avatar: ReactNode;
  title: ReactNode;
  caption: ReactNode;
  onClick?: () => void;
}) => {
  return (
    <SettingGroup contentStyle={{ padding: '10px 8px 10px 10px' }}>
      <div className={styles.profile} onClick={onClick}>
        <div className={styles.avatarWrapper}>{avatar}</div>
        <div className={styles.content}>
          <div className={styles.title}>{title}</div>
          <div className={styles.caption}>{caption}</div>
        </div>
        <ArrowRightSmallIcon className={styles.suffixIcon} />
      </div>
    </SettingGroup>
  );
};

const AuthorizedUserProfile = ({
  account,
}: {
  account: AccountDisplayInfo;
}) => {
  const googleAuthService = useService(GoogleAuthService);

  return (
    <BaseLayout
      avatar={
        <Avatar
          size={48}
          rounded={4}
          url={account?.avatar}
          name={account?.name}
        />
      }
      caption={<span className={styles.emailInfo}>{account.email ?? ''}</span>}
      title={
        <div className={styles.nameWithTag}>
          <span className={styles.name}>{account.name}</span>
        </div>
      }
      onClick={() => {
        googleAuthService.disconnect().catch(console.error);
      }}
    />
  );
};

const UnauthorizedUserProfile = () => {
  const globalDialogService = useService(GlobalDialogService);

  return (
    <BaseLayout
      onClick={() => globalDialogService.open('sign-in', {})}
      avatar={<Avatar size={48} rounded={4} />}
      title="Sign in with Google"
      caption="Connect Drive and Calendar"
    />
  );
};
