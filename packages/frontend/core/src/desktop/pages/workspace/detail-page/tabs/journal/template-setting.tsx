import { DeleteIcon, TemplateIcon } from '@blocksuite/icons/rc';
import { Button, Menu, MenuItem, MenuSeparator } from '@nota/component';
import { DocsService } from '@nota/core/modules/doc';
import { DocDisplayMetaService } from '@nota/core/modules/doc-display-meta';
import { TemplateDocService } from '@nota/core/modules/template-doc';
import { TemplateListMenuContentScrollable } from '@nota/core/modules/template-doc/view/template-list-menu';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import clsx from 'clsx';
import { useCallback, useMemo } from 'react';

import * as styles from './template-setting.css';

export const JournalTemplateSetting = () => {
  const t = useI18n();
  const templateDocService = useService(TemplateDocService);
  const docDisplayService = useService(DocDisplayMetaService);
  const journalTemplateDocId = useLiveData(
    templateDocService.setting.journalTemplateDocId$
  );
  const docsService = useService(DocsService);

  const title = useLiveData(
    useMemo(() => {
      return journalTemplateDocId
        ? docDisplayService.title$(journalTemplateDocId)
        : null;
    }, [docDisplayService, journalTemplateDocId])
  );
  const journalTemplateDoc = useLiveData(
    journalTemplateDocId ? docsService.list.doc$(journalTemplateDocId) : null
  );
  const isDeleted = useLiveData(journalTemplateDoc?.trash$);

  const updateJournalTemplate = useCallback(
    (templateId?: string) => {
      templateDocService.setting.updateJournalTemplateDocId(templateId);
    },
    [templateDocService.setting]
  );

  const removeJournalTemplate = useCallback(() => {
    updateJournalTemplate();
  }, [updateJournalTemplate]);

  return (
    <div className={styles.container}>
      <Menu
        contentOptions={{ className: styles.menu }}
        items={
          <TemplateListMenuContentScrollable
            onSelect={updateJournalTemplate}
            suffixItems={
              journalTemplateDocId ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    prefixIcon={<DeleteIcon />}
                    onClick={removeJournalTemplate}
                    type="danger"
                  >
                    {t['com.affine.template-list.delete']()}
                  </MenuItem>
                </>
              ) : null
            }
          />
        }
      >
        <Button
          variant="plain"
          prefix={
            <TemplateIcon
              className={clsx({ [styles.deletedIcon]: isDeleted })}
            />
          }
          className={styles.trigger}
        >
          {isDeleted ? (
            <del className={styles.deletedText}>{title}</del>
          ) : (
            title
          )}
        </Button>
      </Menu>
      {isDeleted && <div className={styles.deletedTag}>{t['Deleted']()}</div>}
    </div>
  );
};
