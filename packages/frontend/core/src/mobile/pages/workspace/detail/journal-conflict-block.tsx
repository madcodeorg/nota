import { EditIcon, TodayIcon } from '@blocksuite/icons/rc';
import { IconButton, Menu } from '@nota/component';
import { type DocRecord, DocsService } from '@nota/core/modules/doc';
import { DocDisplayMetaService } from '@nota/core/modules/doc-display-meta';
import { JournalService } from '@nota/core/modules/journal';
import { WorkbenchLink } from '@nota/core/modules/workbench';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { useMemo } from 'react';

import * as styles from './journal-conflict-block.css';
import { ResolveConflictOperations } from './menu/journal-conflicts';

export const JournalConflictBlock = ({ date }: { date?: string }) => {
  return date ? <JournalConflictChecker date={date} /> : null;
};

const JournalConflictChecker = ({ date }: { date: string }) => {
  const docRecordList = useService(DocsService).list;
  const journalService = useService(JournalService);
  const docs = useLiveData(
    useMemo(() => journalService.journalsByDate$(date), [journalService, date])
  );
  const docRecords = useLiveData(
    docRecordList.docs$.map(records =>
      records.filter(v => {
        return docs.some(doc => doc.id === v.id);
      })
    )
  );

  if (docRecords.length <= 1) return null;

  return <JournalConflictList docRecords={docRecords} />;
};

const JournalConflictList = ({ docRecords }: { docRecords: DocRecord[] }) => {
  const t = useI18n();
  return (
    <>
      <div className={styles.body}>
        <div className={styles.header}>
          {t['com.affine.editor.journal-conflict.title']()}
        </div>
        {docRecords.map(docRecord => (
          <ConflictItem docRecord={docRecord} key={docRecord.id} />
        ))}
      </div>
      <div className={styles.separator} />
    </>
  );
};

const ConflictItem = ({ docRecord }: { docRecord: DocRecord }) => {
  const docId = docRecord.id;
  const i18n = useI18n();
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const title = useLiveData(docDisplayMetaService.title$(docId));

  return (
    <WorkbenchLink className={styles.docItem} to={`/${docId}`}>
      <TodayIcon className={styles.icon} />
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        <div className={styles.duplicatedTag}>
          {i18n['com.affine.page-properties.property.journal-duplicated']()}
        </div>
      </div>
      <Menu items={<ResolveConflictOperations docRecord={docRecord} />}>
        <IconButton className={styles.edit} icon={<EditIcon />} />
      </Menu>
    </WorkbenchLink>
  );
};
