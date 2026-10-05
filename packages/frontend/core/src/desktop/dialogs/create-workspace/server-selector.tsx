import {
  ArrowDownSmallIcon,
  CloudWorkspaceIcon,
  DoneIcon,
  LocalWorkspaceIcon,
  SelfhostIcon,
} from '@blocksuite/icons/rc';
import { Menu, MenuItem } from '@nota/component';
import { type Server, ServersService } from '@nota/core/modules/cloud';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import clsx from 'clsx';
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';

import * as styles from './server-selector.css';
import { selectableWorkspaceServers } from './server-selector-options';

export interface ServerSelectorProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'onChange'
> {
  selectedId: Server['id'];
  onChange: (id: Server['id']) => void;
  placeholder?: ReactNode;
}
export const ServerSelector = ({
  selectedId,
  onChange,
  placeholder,
  className,
  ...props
}: ServerSelectorProps) => {
  const t = useI18n();
  const [open, setOpen] = useState(false);

  const serversService = useService(ServersService);
  const servers = useLiveData(serversService.servers$);
  const selectableServers = useMemo(
    () => selectableWorkspaceServers(servers, BUILD_CONFIG.isElectron),
    [servers]
  );
  const googleAuthService = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuthService.session.status$);

  const selectedServer = useMemo(() => {
    return selectableServers.find(s => s.id === selectedId);
  }, [selectableServers, selectedId]);

  const serverName = useLiveData(
    selectedServer?.config$.selector(c => c.serverName)
  );
  const selectedServerName =
    selectedId === 'local'
      ? t['com.affine.workspaceList.workspaceListType.local']()
      : selectedId === 'google-drive'
        ? 'Google Drive'
        : serverName;

  return (
    <Menu
      rootOptions={{
        open,
        onOpenChange: setOpen,
      }}
      contentOptions={{
        style: {
          maxWidth: 432,
          width: 'calc(100dvw - 68px)',
        },
      }}
      items={
        <ul className={styles.list} data-testid="server-selector-list">
          <LocalSelectorItem
            onSelect={onChange}
            active={selectedId === 'local'}
          />
          {googleStatus === 'connected' ? (
            <GoogleDriveSelectorItem
              onSelect={onChange}
              active={selectedId === 'google-drive'}
            />
          ) : null}
          {selectableServers.map(server => (
            <ServerSelectorItem
              key={server.id}
              server={server}
              onSelect={onChange}
              active={selectedId === server.id}
            />
          ))}
        </ul>
      }
    >
      <div
        data-testid="server-selector-trigger"
        className={clsx(styles.trigger, className)}
        {...props}
      >
        {selectedServerName ?? placeholder}
        <ArrowDownSmallIcon className={clsx(styles.arrow, { open })} />
      </div>
    </Menu>
  );
};

const GoogleDriveSelectorItem = ({
  onSelect,
  active,
}: {
  onSelect?: (id: string) => void;
  active?: boolean;
}) => {
  const handleSelect = useCallback(() => {
    onSelect?.('google-drive');
  }, [onSelect]);

  return (
    <MenuItem
      data-testid="google-drive"
      className={styles.item}
      prefixIcon={<CloudWorkspaceIcon />}
      onClick={handleSelect}
      suffixIcon={active ? <DoneIcon className={styles.done} /> : null}
    >
      Google Drive
    </MenuItem>
  );
};

const LocalSelectorItem = ({
  onSelect,
  active,
}: {
  onSelect?: (id: string) => void;
  active?: boolean;
}) => {
  const t = useI18n();
  const handleSelect = useCallback(() => {
    onSelect?.('local');
  }, [onSelect]);
  return (
    <MenuItem
      data-testid="local"
      className={styles.item}
      prefixIcon={<LocalWorkspaceIcon />}
      onClick={handleSelect}
      suffixIcon={active ? <DoneIcon className={styles.done} /> : null}
    >
      {t['com.affine.workspaceList.workspaceListType.local']()}
    </MenuItem>
  );
};

const ServerSelectorItem = ({
  server,
  onSelect,
  active,
}: {
  server: Server;
  onSelect?: (id: string) => void;
  active?: boolean;
}) => {
  const name = useLiveData(server.config$.selector(c => c.serverName));

  const Icon = server.id === 'nota-cloud' ? CloudWorkspaceIcon : SelfhostIcon;

  const handleSelect = useCallback(() => {
    onSelect?.(server.id);
  }, [onSelect, server.id]);

  return (
    <MenuItem
      data-testid={server.id}
      className={styles.item}
      prefixIcon={<Icon />}
      onClick={handleSelect}
      suffixIcon={active ? <DoneIcon className={styles.done} /> : null}
    >
      {name}
    </MenuItem>
  );
};
