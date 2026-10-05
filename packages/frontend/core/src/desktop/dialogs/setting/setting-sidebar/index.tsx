import { Scrollable } from '@nota/component';
import { NotaLogoIcon } from '@nota/component/auth-components';
import { Avatar } from '@nota/component/ui/avatar';
import {
  type AccountDisplayInfo,
  useAccountDisplay,
} from '@nota/core/components/hooks/use-account-display';
import { GlobalDialogService } from '@nota/core/modules/dialogs';
import type { SettingTab } from '@nota/core/modules/dialogs/constant';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import { track } from '@nota/track';
import clsx from 'clsx';
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
} from 'react';

import { useGeneralSettingList } from '../general-setting';
import { useWorkspaceSettingList } from '../workspace-setting';
import * as style from './style.css';

export type UserInfoProps = {
  account: AccountDisplayInfo;
  onAccountSettingClick: () => void;
  active?: boolean;
};

export const UserInfo = ({
  account,
  onAccountSettingClick,
  active,
}: UserInfoProps) => {
  return (
    <button
      type="button"
      data-testid="user-info-card"
      className={clsx(style.accountButton, {
        active: active,
      })}
      aria-current={active ? 'page' : undefined}
      onClick={onAccountSettingClick}
    >
      <Avatar
        size={28}
        rounded={2}
        name={account.name}
        url={account.avatar}
        className="avatar"
      />

      <div className="content">
        <div className="name-container">
          <div className="name" title={account.name}>
            {account.name}
          </div>
        </div>

        {account.email ? (
          <div className="email" title={account.email}>
            {account.email}
          </div>
        ) : null}
      </div>
    </button>
  );
};

export const SignInButton = () => {
  const globalDialogService = useService(GlobalDialogService);

  return (
    <button
      type="button"
      className={style.accountButton}
      onClick={useCallback(() => {
        globalDialogService.open('sign-in', {});
      }, [globalDialogService])}
    >
      <div className="avatar not-sign">
        <NotaLogoIcon width={18} height={18} />
      </div>

      <div className="content">
        <div className="name" title="Sign in with Google">
          Sign in with Google
        </div>
        <div className="email" title="Connect Drive and Calendar">
          Drive &amp; Calendar
        </div>
      </div>
    </button>
  );
};

type SettingSidebarItemProps = {
  isActive: boolean;
  icon: ReactNode;
  title: string;
  key: string;
  testId?: string;
  beta?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const SettingSidebarItem = ({
  isActive,
  icon,
  title,
  testId,
  beta,
  ...props
}: SettingSidebarItemProps) => {
  return (
    <button
      type="button"
      {...props}
      title={title}
      data-testid={testId}
      aria-current={isActive ? 'page' : undefined}
      className={clsx(style.sidebarSelectItem, {
        active: isActive,
      })}
    >
      <div className={style.sidebarSelectItemIcon}>{icon}</div>
      <div className={style.sidebarSelectItemName}>{title}</div>
      {beta ? <div className={style.sidebarSelectItemBeta}>Beta</div> : null}
    </button>
  );
};

const SettingSidebarGroup = ({
  title,
  items,
}: {
  title: string;
  items: SettingSidebarItemProps[];
}) => {
  return (
    <div className={style.sidebarGroup}>
      <div className={style.sidebarSubtitle}>{title}</div>
      <div className={style.sidebarItemsWrapper}>
        {items.map(({ key, ...props }) => (
          <SettingSidebarItem key={key} {...props} />
        ))}
      </div>
    </div>
  );
};

export const SettingSidebar = ({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingTab;
  onTabChange: (key: SettingTab) => void;
}) => {
  const t = useI18n();
  const account = useAccountDisplay();
  const generalList = useGeneralSettingList();
  const workspaceSettingList = useWorkspaceSettingList();
  const gotoTab = useCallback(
    (tab: SettingTab) => {
      track.$.settingsPanel.menu.openSettings({ to: tab });
      onTabChange(tab);
    },
    [onTabChange]
  );
  const onAccountSettingClick = useCallback(() => {
    track.$.settingsPanel.menu.openSettings({ to: 'account' });
    onTabChange('account');
  }, [onTabChange]);

  const groups = useMemo(() => {
    const res = [
      {
        key: 'setting:general',
        title: t['com.affine.settingSidebar.settings.general'](),
        items: generalList,
      },
      {
        key: 'setting:workspace',
        title: t['com.affine.settingSidebar.settings.workspace'](),
        items: workspaceSettingList,
      },
    ].map(group => {
      return {
        ...group,
        items: group.items.map(item => {
          return {
            ...item,
            isActive: item.key === activeTab,
            'data-event-arg': item.key,
            onClick: () => gotoTab(item.key),
          };
        }),
      };
    });
    return res;
  }, [activeTab, generalList, gotoTab, t, workspaceSettingList]);

  return (
    <div className={style.settingSlideBar} data-testid="settings-sidebar">
      <div className={style.brandHeader}>
        <div className={style.brandLogo}>
          <NotaLogoIcon width={20} height={20} />
        </div>
        <div className={style.sidebarTitle}>
          {t['com.affine.settingSidebar.title']()}
        </div>
      </div>

      {account ? (
        <Suspense>
          <UserInfo
            account={account}
            onAccountSettingClick={onAccountSettingClick}
            active={activeTab === 'account'}
          />
        </Suspense>
      ) : (
        <SignInButton />
      )}

      <Scrollable.Root className={style.navScroll}>
        <Scrollable.Viewport>
          {groups.map(group => (
            <SettingSidebarGroup
              key={group.key}
              title={group.title}
              items={group.items}
            />
          ))}
          <Scrollable.Scrollbar />
        </Scrollable.Viewport>
      </Scrollable.Root>
    </div>
  );
};
