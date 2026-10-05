import { ShareiOsIcon } from '@blocksuite/icons/rc';
import { IconButton, MobileMenu } from '@nota/component';
import { useEnableCloud } from '@nota/core/components/hooks/nota/use-enable-cloud';
import { DocService } from '@nota/core/modules/doc';
import { ShareMenuContent } from '@nota/core/modules/share-menu';
import {
  isServerBackedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useServices } from '@nota/infra';

import * as styles from './page-header-share-button.css';

export const PageHeaderShareButton = () => {
  const { workspaceService, docService } = useServices({
    WorkspaceService,
    DocService,
  });
  const workspace = workspaceService.workspace;
  const doc = docService.doc.blockSuiteDoc;
  const confirmEnableCloud = useEnableCloud();

  if (!isServerBackedWorkspaceFlavour(workspace.meta.flavour)) {
    return null;
  }

  return (
    <MobileMenu
      items={
        <div className={styles.content}>
          <ShareMenuContent
            workspaceMetadata={workspace.meta}
            currentPage={doc}
            onEnableAffineCloud={() =>
              confirmEnableCloud(workspace, {
                openPageId: doc.id,
              })
            }
          />
        </div>
      }
    >
      <IconButton size={24} style={{ padding: 10 }} icon={<ShareiOsIcon />} />
    </MobileMenu>
  );
};
