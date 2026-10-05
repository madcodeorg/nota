import type { DocMode } from '@blocksuite/affine/model';
import { BlocksuiteHeaderTitle } from '@nota/core/blocksuite/block-suite-header/title';
import { EditorModeSwitch } from '@nota/core/blocksuite/block-suite-mode-switch';
import ShareHeaderRightItem from '@nota/core/components/cloud/share-header-right-item';

import * as styles from './share-header.css';

export function ShareHeader({
  publishMode,
  isTemplate,
  templateName,
  snapshotUrl,
}: {
  pageId: string;
  publishMode: DocMode;
  isTemplate?: boolean;
  templateName?: string;
  snapshotUrl?: string;
}) {
  return (
    <div className={styles.header}>
      <EditorModeSwitch />
      <BlocksuiteHeaderTitle />
      <div className={styles.spacer} />
      <ShareHeaderRightItem
        publishMode={publishMode}
        isTemplate={isTemplate}
        snapshotUrl={snapshotUrl}
        templateName={templateName}
      />
    </div>
  );
}
