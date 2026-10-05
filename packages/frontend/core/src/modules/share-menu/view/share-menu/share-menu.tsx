import type { Store } from '@blocksuite/affine/store';
import { LockIcon, PublishIcon } from '@blocksuite/icons/rc';
import { Tooltip } from '@nota/component';
import { Button } from '@nota/component/ui/button';
import { Menu } from '@nota/component/ui/menu';
import { ShareInfoService } from '@nota/core/modules/share-doc';
import {
  isUserOwnedWorkspaceFlavour,
  type WorkspaceMetadata,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { forwardRef, type PropsWithChildren, type Ref, useEffect } from 'react';

import * as styles from './index.css';
import { ShareExport } from './share-export';

export interface ShareMenuProps extends PropsWithChildren {
  workspaceMetadata: WorkspaceMetadata;
  currentPage: Store;
  onEnableAffineCloud: () => void;
  onOpenShareModal?: (open: boolean) => void;
  openPaywallModal?: () => void;
  hittingPaywall?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export const ShareMenuContent = (_props: ShareMenuProps) => {
  // Publishing a page needs a Nota Cloud server — none exists. Only local
  // Export is offered now.
  return (
    <div className={styles.containerStyle}>
      <ShareExport />
    </div>
  );
};

const DefaultShareButton = forwardRef(function DefaultShareButton(
  props: { disabled?: boolean; tooltip?: string },
  ref: Ref<HTMLButtonElement>
) {
  const t = useI18n();
  const shareInfoService = useService(ShareInfoService);
  const shared = useLiveData(shareInfoService.shareInfo.isShared$);

  useEffect(() => {
    if (props.disabled) {
      return;
    }
    shareInfoService.shareInfo.revalidate();
  }, [props.disabled, shareInfoService]);

  const tooltip =
    props.tooltip ??
    (shared
      ? t['com.affine.share-menu.option.link.readonly.description']()
      : t['com.affine.share-menu.option.link.no-access.description']());

  return (
    <Tooltip content={tooltip}>
      <Button
        ref={ref}
        className={styles.button}
        variant="primary"
        disabled={props.disabled}
      >
        <div className={styles.buttonContainer}>
          {shared ? <PublishIcon fontSize={16} /> : <LockIcon fontSize={16} />}
          {t['com.affine.share-menu.shareButton']()}
        </div>
      </Button>
    </Tooltip>
  );
});

const LocalShareMenu = (props: ShareMenuProps) => {
  if (props.disabled) {
    return (
      <div data-testid="local-share-menu-button">
        <DefaultShareButton disabled tooltip={props.disabledReason} />
      </div>
    );
  }
  return (
    <Menu
      items={<ShareMenuContent {...props} />}
      contentOptions={{
        className: styles.localMenuStyle,
        ['data-testid' as string]: 'local-share-menu',
        align: 'end',
      }}
      rootOptions={{
        modal: false,
        onOpenChange: props.onOpenShareModal,
      }}
    >
      <div data-testid="local-share-menu-button">
        {props.children || <DefaultShareButton />}
      </div>
    </Menu>
  );
};

const CloudShareMenu = (props: ShareMenuProps) => {
  if (props.disabled) {
    return (
      <div data-testid="cloud-share-menu-button">
        <DefaultShareButton disabled tooltip={props.disabledReason} />
      </div>
    );
  }
  return (
    <Menu
      items={<ShareMenuContent {...props} />}
      contentOptions={{
        className: styles.menuStyle,
        ['data-testid' as string]: 'cloud-share-menu',
        align: 'end',
      }}
      rootOptions={{
        modal: false,
        onOpenChange: props.onOpenShareModal,
      }}
    >
      <div data-testid="cloud-share-menu-button">
        {props.children || <DefaultShareButton />}
      </div>
    </Menu>
  );
};

export const ShareMenu = (props: ShareMenuProps) => {
  const { workspaceMetadata } = props;

  if (isUserOwnedWorkspaceFlavour(workspaceMetadata.flavour)) {
    return <LocalShareMenu {...props} />;
  }
  return <CloudShareMenu {...props} />;
};
