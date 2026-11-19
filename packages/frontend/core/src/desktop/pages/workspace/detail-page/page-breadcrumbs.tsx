import { DocDisplayMetaService } from '@nota/core/modules/doc-display-meta';
import {
  type OrganizeBreadcrumbItem,
  OrganizeService,
} from '@nota/core/modules/organize';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { Fragment, memo, useMemo } from 'react';
import { RiFileTextLine, RiFolder3Line } from 'react-icons/ri';

import * as styles from './page-breadcrumbs.css';

const DocCrumb = memo(function DocCrumb({ docId }: { docId: string }) {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const workbench = useService(WorkbenchService).workbench;
  const i18n = useI18n();
  const title = i18n.t(useLiveData(docDisplayMetaService.title$(docId)));

  return (
    <button
      type="button"
      className={styles.crumbButton}
      title={title}
      data-testid={`page-breadcrumb-doc-${docId}`}
      onClick={() => workbench.openDoc(docId)}
    >
      <RiFileTextLine className={styles.crumbIcon} size={14} aria-hidden />
      <span className={styles.crumbLabel}>{title}</span>
    </button>
  );
});

const FolderCrumb = memo(function FolderCrumb({
  nodeId,
  name,
}: {
  nodeId: string;
  name: string;
}) {
  const label = name || 'Untitled folder';
  return (
    <span
      className={styles.crumb}
      title={label}
      data-testid={`page-breadcrumb-folder-${nodeId}`}
    >
      <RiFolder3Line className={styles.crumbIcon} size={14} aria-hidden />
      <span className={styles.crumbLabel}>{label}</span>
    </span>
  );
});

export const PageBreadcrumbs = memo(function PageBreadcrumbs({
  pageId,
}: {
  pageId: string;
}) {
  const organizeService = useService(OrganizeService);
  const ancestors$ = useMemo(
    () => organizeService.folderTree.ancestorsForDoc$(pageId),
    [organizeService, pageId]
  );
  const ancestors = useLiveData(ancestors$);

  if (!ancestors.length) {
    return null;
  }

  return (
    <nav
      className={styles.breadcrumbs}
      aria-label="Page hierarchy"
      data-testid="page-breadcrumbs"
    >
      {ancestors.map((item: OrganizeBreadcrumbItem) => (
        <Fragment key={item.nodeId}>
          {item.type === 'folder' ? (
            <FolderCrumb nodeId={item.nodeId} name={item.name} />
          ) : (
            <DocCrumb docId={item.docId} />
          )}
          <span className={styles.separator} aria-hidden>
            /
          </span>
        </Fragment>
      ))}
    </nav>
  );
});
