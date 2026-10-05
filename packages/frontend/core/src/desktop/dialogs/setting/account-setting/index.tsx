import { FlexWrapper, notify, useConfirmModal } from '@nota/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@nota/component/setting-components';
import { Avatar } from '@nota/component/ui/avatar';
import { Button } from '@nota/component/ui/button';
import {
  type AccountDisplayInfo,
  useAccountDisplay,
} from '@nota/core/components/hooks/use-account-display';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';

import * as styles from './style.css';

const GoogleAccountSetting = ({ account }: { account: AccountDisplayInfo }) => {
  const googleAuthService = useService(GoogleAuthService);
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();

  const disconnectGoogle = () => {
    openConfirmModal({
      title: 'Disconnect Google?',
      children:
        'This disconnects both Google Drive and Google Calendar on this device. Your local Nota notes stay available.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      confirmButtonOptions: { variant: 'error' },
      onConfirm: () => googleAuthService.disconnect(),
    });
  };

  return (
    <>
      <SettingHeader
        title={t['com.affine.setting.account']()}
        subtitle="Google is the account used for Drive and Calendar."
        data-testid="account-title"
      />
      <SettingWrapper>
        <SettingRow
          name={t['com.affine.settings.profile']()}
          desc="Connected with Google"
          spreadCol={false}
        >
          <FlexWrapper style={{ margin: '12px 0 24px 0' }} alignItems="center">
            <Avatar
              size={56}
              name={account.name}
              url={account.avatar}
              data-testid="user-setting-avatar"
            />
            <div className={styles.profileInputWrapper}>
              <div className="label">Google account</div>
              <div>{account.name}</div>
              {account.email ? <div>{account.email}</div> : null}
            </div>
          </FlexWrapper>
        </SettingRow>
        <SettingRow
          name="Google connection"
          desc={
            account.email
              ? `${account.email}. Disconnecting stops Drive and Google Calendar access on this device.`
              : 'Disconnecting stops Drive and Google Calendar access on this device.'
          }
        >
          <Button onClick={disconnectGoogle}>Disconnect Google</Button>
        </SettingRow>
      </SettingWrapper>
    </>
  );
};

export const AccountSetting = () => {
  const accountDisplay = useAccountDisplay();
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);
  const t = useI18n();

  if (accountDisplay) {
    return <GoogleAccountSetting account={accountDisplay} />;
  }

  return (
    <>
      <SettingHeader
        title={t['com.affine.setting.account']()}
        subtitle="Google is optional. Connect once to use Drive and Google Calendar; local notes keep working without it."
        data-testid="account-title"
      />
      <SettingWrapper>
        <SettingRow
          name="Google Drive & Calendar"
          desc="No Google account is connected on this device."
        >
          <Button
            loading={googleStatus === 'connecting'}
            disabled={googleStatus === 'connecting'}
            onClick={() => {
              googleAuthService.connect().catch(error => {
                notify.error({
                  title: error instanceof Error ? error.message : String(error),
                });
              });
            }}
          >
            Connect Google
          </Button>
        </SettingRow>
      </SettingWrapper>
    </>
  );
};
