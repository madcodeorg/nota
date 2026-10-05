import {
  AccountIcon,
  CloudWorkspaceIcon,
  DeleteIcon,
  LocalWorkspaceIcon,
  MoreHorizontalIcon,
  SelfhostIcon,
  SignOutIcon,
} from '@blocksuite/icons/rc';
import { IconButton, Menu, MenuItem } from '@nota/component';
import { Divider } from '@nota/component/ui/divider';
import { useEnableCloud } from '@nota/core/components/hooks/nota/use-enable-cloud';
import { useSignOut } from '@nota/core/components/hooks/nota/use-sign-out';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { useNavigateHelper } from '@nota/core/components/hooks/use-navigate-helper';
import type { AuthAccountInfo, Server } from '@nota/core/modules/cloud';
import { AuthService, ServersService } from '@nota/core/modules/cloud';
import { GlobalDialogService } from '@nota/core/modules/dialogs';
import { GlobalContextService } from '@nota/core/modules/global-context';
import {
  GoogleAuthService,
  type GoogleUserInfo,
} from '@nota/core/modules/google-auth';
import {
  type WorkspaceMetadata,
  WorkspaceService,
  WorkspacesService,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import {
  FrameworkScope,
  useLiveData,
  useService,
  useServiceOptional,
} from '@nota/infra';
import { useCallback, useMemo } from 'react';

import { WorkspaceCard } from '../../workspace-card';
import * as styles from './index.css';

interface WorkspaceModalProps {
  workspaces: WorkspaceMetadata[];
  onClickWorkspace: (workspaceMetadata: WorkspaceMetadata) => void;
  onClickWorkspaceSetting?: (workspaceMetadata: WorkspaceMetadata) => void;
  onClickEnableCloud?: (meta: WorkspaceMetadata) => void;
  onNewWorkspace: () => void;
  onAddWorkspace: () => void;
}

const WorkspaceServerInfo = ({
  server,
  name,
  account,
  accountStatus,
  onDeleteServer,
  onSignOut,
  description,
}: {
  server: string;
  name: string;
  account?: { email?: string } | AuthAccountInfo | null;
  accountStatus?: 'authenticated' | 'unauthenticated';
  onDeleteServer?: () => void;
  onSignOut?: () => void;
  description?: string;
}) => {
  const t = useI18n();
  const isGoogleDrive = server === 'google-drive';
  const isCloud = server !== 'local';
  const isNotaCloud = server === 'nota-cloud';
  const accountDescription = description ?? account?.email ?? null;
  const Icon =
    isNotaCloud || isGoogleDrive
      ? CloudWorkspaceIcon
      : isCloud
        ? SelfhostIcon
        : LocalWorkspaceIcon;

  const menuItems = useMemo(
    () =>
      [
        server !== 'nota-cloud' &&
          server !== 'local' &&
          server !== 'google-drive' && (
            <MenuItem
              prefixIcon={<DeleteIcon />}
              type="danger"
              key="delete-server"
              onClick={onDeleteServer}
            >
              {t['com.affine.server.delete']()}
            </MenuItem>
          ),
        accountStatus === 'authenticated' && (
          <MenuItem
            prefixIcon={<SignOutIcon />}
            key="sign-out"
            onClick={onSignOut}
            type="danger"
          >
            {t['Sign out']()}
          </MenuItem>
        ),
      ].filter(Boolean),
    [accountStatus, onDeleteServer, onSignOut, server, t]
  );

  return (
    <div className={styles.workspaceServer}>
      <div className={styles.workspaceServerIcon}>
        <Icon />
      </div>
      <div className={styles.workspaceServerContent}>
        <div className={styles.workspaceServerName}>{name}</div>
        {(isCloud || description) && accountDescription ? (
          <div className={styles.workspaceServerAccount}>
            {accountDescription}
          </div>
        ) : null}
      </div>
      <div className={styles.workspaceServerSpacer} />
      {menuItems.length ? (
        <Menu items={menuItems}>
          <IconButton
            icon={<MoreHorizontalIcon className={styles.infoMoreIcon} />}
          />
        </Menu>
      ) : null}
    </div>
  );
};

const GoogleDriveWorkspaces = ({
  workspaces,
  onClickWorkspace,
}: {
  workspaces: WorkspaceMetadata[];
  onClickWorkspace: (workspaceMetadata: WorkspaceMetadata) => void;
}) => {
  const googleAuthService = useService(GoogleAuthService);
  const status = useLiveData(googleAuthService.session.status$);
  const userInfo = useLiveData(
    googleAuthService.session.userInfo$
  ) as GoogleUserInfo | null;

  const handleDisconnect = useCallback(() => {
    googleAuthService.disconnect().catch(console.error);
  }, [googleAuthService]);

  if (status !== 'connected' || !userInfo || workspaces.length === 0) {
    return null;
  }

  return (
    <>
      <WorkspaceServerInfo
        server="google-drive"
        name="Google Drive"
        account={userInfo}
        accountStatus="authenticated"
        onSignOut={handleDisconnect}
      />
      <WorkspaceList items={workspaces} onClick={onClickWorkspace} />
    </>
  );
};

const CloudWorkSpaceList = ({
  server,
  workspaces,
  onClickWorkspace,
  onClickEnableCloud,
}: {
  server: Server;
  workspaces: WorkspaceMetadata[];
  onClickWorkspace: (workspaceMetadata: WorkspaceMetadata) => void;
  onClickEnableCloud?: (meta: WorkspaceMetadata) => void;
}) => {
  const t = useI18n();
  const globalContextService = useService(GlobalContextService);
  const globalDialogService = useService(GlobalDialogService);
  const serverName = useLiveData(server.config$.selector(c => c.serverName));
  const authService = useService(AuthService);
  const serversService = useService(ServersService);
  const account = useLiveData(authService.session.account$);
  const accountStatus = useLiveData(authService.session.status$);
  const navigateHelper = useNavigateHelper();

  const currentWorkspaceFlavour = useLiveData(
    globalContextService.globalContext.workspaceFlavour.$
  );

  const handleDeleteServer = useCallback(() => {
    serversService.removeServer(server.id);

    if (currentWorkspaceFlavour === server.id) {
      const otherWorkspace = workspaces.find(w => w.flavour !== server.id);
      if (otherWorkspace) {
        navigateHelper.openPage(otherWorkspace.id, 'all');
      }
    }
  }, [
    currentWorkspaceFlavour,
    navigateHelper,
    server.id,
    serversService,
    workspaces,
  ]);

  const handleSignOut = useSignOut();

  const handleSignIn = useAsyncCallback(async () => {
    globalDialogService.open('sign-in', {
      server: server.baseUrl,
    });
  }, [globalDialogService, server.baseUrl]);

  return (
    <>
      <WorkspaceServerInfo
        server={server.id}
        name={serverName}
        account={account}
        accountStatus={accountStatus}
        onDeleteServer={handleDeleteServer}
        onSignOut={handleSignOut}
      />
      {accountStatus === 'unauthenticated' ? (
        <MenuItem key="sign-in" onClick={handleSignIn}>
          <div className={styles.signInMenuItemContent}>
            <div className={styles.signInIconWrapper}>
              <AccountIcon />
            </div>
            <div className={styles.signInText}>{t['Sign in']()}</div>
          </div>
        </MenuItem>
      ) : null}
      <WorkspaceList
        items={workspaces}
        onClick={onClickWorkspace}
        onEnableCloudClick={onClickEnableCloud}
      />
    </>
  );
};

const LocalWorkspaces = ({
  workspaces,
  onClickWorkspace,
  onClickWorkspaceSetting,
  onClickEnableCloud,
}: Omit<WorkspaceModalProps, 'onNewWorkspace' | 'onAddWorkspace'>) => {
  const t = useI18n();
  if (workspaces.length === 0) {
    return null;
  }
  return (
    <>
      <WorkspaceServerInfo
        server="local"
        name={t['com.affine.workspaceList.workspaceListType.local']()}
        description={t[
          'com.affine.workspaceList.workspaceListType.local.description'
        ]()}
      />
      <WorkspaceList
        items={workspaces}
        onClick={onClickWorkspace}
        onSettingClick={onClickWorkspaceSetting}
        onEnableCloudClick={onClickEnableCloud}
      />
    </>
  );
};

export const NotaWorkspaceList = ({
  onEventEnd,
  onClickWorkspace,
  showEnableCloudButton,
}: {
  onClickWorkspace?: (workspaceMetadata: WorkspaceMetadata) => void;
  onEventEnd?: () => void;
  showEnableCloudButton?: boolean;
}) => {
  const workspacesService = useService(WorkspacesService);
  const workspaces = useLiveData(workspacesService.list.workspaces$);

  const confirmEnableCloud = useEnableCloud();

  const serversService = useService(ServersService);
  const servers = useLiveData(serversService.servers$);
  const notaCloudServer = useMemo(
    () => servers.find(s => s.id === 'nota-cloud'),
    [servers]
  );
  const selfhostServers = useMemo(
    () => servers.filter(s => s.id !== 'nota-cloud'),
    [servers]
  );

  const cloudWorkspaces = useMemo(
    () =>
      workspaces.filter(
        ({ flavour }) => flavour !== 'local' && flavour !== 'google-drive'
      ) as WorkspaceMetadata[],
    [workspaces]
  );
  const googleDriveWorkspaces = useMemo(
    () =>
      workspaces.filter(
        ({ flavour }) => flavour === 'google-drive'
      ) as WorkspaceMetadata[],
    [workspaces]
  );

  const localWorkspaces = useMemo(
    () =>
      workspaces.filter(
        ({ flavour }) => flavour === 'local'
      ) as WorkspaceMetadata[],
    [workspaces]
  );
  const notaCloudWorkspaces = useMemo(
    () =>
      notaCloudServer
        ? cloudWorkspaces.filter(
            ({ flavour }) => flavour === notaCloudServer.id
          )
        : [],
    [cloudWorkspaces, notaCloudServer]
  );
  const selfhostWorkspaceSections = useMemo(
    () =>
      selfhostServers
        .map(server => ({
          server,
          workspaces: cloudWorkspaces.filter(
            ({ flavour }) => flavour === server.id
          ),
        }))
        .filter(section => section.workspaces.length > 0),
    [cloudWorkspaces, selfhostServers]
  );
  const hasNotaCloudWorkspaces = notaCloudWorkspaces.length > 0;
  const hasGoogleDriveWorkspaces = googleDriveWorkspaces.length > 0;
  const hasLocalWorkspaces = localWorkspaces.length > 0;
  const hasSelfhostWorkspaces = selfhostWorkspaceSections.length > 0;

  const onClickEnableCloud = useCallback(
    (meta: WorkspaceMetadata) => {
      const { workspace, dispose } = workspacesService.open({ metadata: meta });
      confirmEnableCloud(workspace, {
        onFinished: () => {
          dispose();
        },
      });
    },
    [confirmEnableCloud, workspacesService]
  );

  const handleClickWorkspace = useCallback(
    (workspaceMetadata: WorkspaceMetadata) => {
      onClickWorkspace?.(workspaceMetadata);
      onEventEnd?.();
    },
    [onClickWorkspace, onEventEnd]
  );

  return (
    <>
      {/* 1. nota-cloud */}
      {hasNotaCloudWorkspaces && notaCloudServer ? (
        <FrameworkScope key={notaCloudServer.id} scope={notaCloudServer.scope}>
          <CloudWorkSpaceList
            server={notaCloudServer}
            workspaces={notaCloudWorkspaces}
            onClickWorkspace={handleClickWorkspace}
          />
        </FrameworkScope>
      ) : null}
      {hasNotaCloudWorkspaces &&
      (hasGoogleDriveWorkspaces ||
        hasLocalWorkspaces ||
        hasSelfhostWorkspaces) ? (
        <Divider size="thinner" className={styles.serverDivider} />
      ) : null}

      <GoogleDriveWorkspaces
        workspaces={googleDriveWorkspaces}
        onClickWorkspace={handleClickWorkspace}
      />
      {hasGoogleDriveWorkspaces &&
      (hasLocalWorkspaces || hasSelfhostWorkspaces) ? (
        <Divider size="thinner" className={styles.serverDivider} />
      ) : null}

      {/* 2. local */}
      <LocalWorkspaces
        workspaces={localWorkspaces}
        onClickWorkspace={handleClickWorkspace}
        onClickEnableCloud={
          showEnableCloudButton ? onClickEnableCloud : undefined
        }
      />
      {hasLocalWorkspaces && hasSelfhostWorkspaces ? (
        <Divider size="thinner" className={styles.serverDivider} />
      ) : null}

      {/* 3. selfhost */}
      {selfhostWorkspaceSections.map(({ server, workspaces }, index) => (
        <FrameworkScope key={server.id} scope={server.scope}>
          <CloudWorkSpaceList
            server={server}
            workspaces={workspaces}
            onClickWorkspace={handleClickWorkspace}
          />
          {index !== selfhostWorkspaceSections.length - 1 && (
            <Divider size="thinner" className={styles.serverDivider} />
          )}
        </FrameworkScope>
      ))}
      <Divider size="thinner" />
    </>
  );
};

interface WorkspaceListProps {
  items: WorkspaceMetadata[];
  onClick: (workspace: WorkspaceMetadata) => void;
  onSettingClick?: (workspace: WorkspaceMetadata) => void;
  onEnableCloudClick?: (meta: WorkspaceMetadata) => void;
}

interface SortableWorkspaceItemProps extends Omit<WorkspaceListProps, 'items'> {
  workspaceMetadata: WorkspaceMetadata;
}

const SortableWorkspaceItem = ({
  workspaceMetadata,
  onClick,
  onSettingClick,
  onEnableCloudClick,
}: SortableWorkspaceItemProps) => {
  const handleClick = useCallback(() => {
    onClick(workspaceMetadata);
  }, [onClick, workspaceMetadata]);

  const currentWorkspace = useServiceOptional(WorkspaceService)?.workspace;

  return (
    <WorkspaceCard
      className={styles.workspaceCard}
      infoClassName={styles.workspaceCardInfoContainer}
      workspaceMetadata={workspaceMetadata}
      onClick={handleClick}
      avatarSize={22}
      active={currentWorkspace?.id === workspaceMetadata.id}
      onClickOpenSettings={onSettingClick}
      onClickEnableCloud={onEnableCloudClick}
    />
  );
};

export const WorkspaceList = (props: WorkspaceListProps) => {
  const workspaceList = props.items;

  return workspaceList.map(item => (
    <SortableWorkspaceItem key={item.id} {...props} workspaceMetadata={item} />
  ));
};
