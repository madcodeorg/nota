import { useExportPage } from '@nota/core/components/hooks/nota/use-export-page';
import {
  ExportMenuItems,
  PrintMenuItems,
} from '@nota/core/components/page-list';
import { EditorService } from '@nota/core/modules/editor';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';

import * as styles from './index.css';

export const ShareExport = () => {
  const t = useI18n();
  const editor = useService(EditorService).editor;
  const exportHandler = useExportPage();
  const currentMode = useLiveData(editor.mode$);

  return (
    <div className={styles.exportContainerStyle}>
      <div className={styles.descriptionStyle}>
        {t['com.affine.share-menu.ShareViaExportDescription']()}
      </div>
      <div className={styles.exportContainerStyle}>
        <ExportMenuItems
          exportHandler={exportHandler}
          className={styles.exportItemStyle}
          pageMode={currentMode}
        />
      </div>
      {currentMode === 'page' && (
        <>
          <div className={styles.descriptionStyle}>
            {t['com.affine.share-menu.ShareViaPrintDescription']()}
          </div>
          <div>
            <PrintMenuItems
              exportHandler={exportHandler}
              className={styles.exportItemStyle}
            />
          </div>
        </>
      )}
    </div>
  );
};
