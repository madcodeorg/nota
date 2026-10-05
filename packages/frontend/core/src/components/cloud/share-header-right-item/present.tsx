import { PresentationIcon } from '@blocksuite/icons/rc';
import { Button } from '@nota/component/ui/button';
import { EditorService } from '@nota/core/modules/editor';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';

import * as styles from './styles.css';

export const PresentButton = () => {
  const t = useI18n();
  const editorService = useService(EditorService);
  const isPresent = useLiveData(editorService.editor.isPresenting$);

  return (
    <Button
      prefix={<PresentationIcon />}
      className={styles.presentButton}
      onClick={() => editorService.editor.togglePresentation()}
      disabled={isPresent}
    >
      {t['com.affine.share-page.header.present']()}
    </Button>
  );
};
