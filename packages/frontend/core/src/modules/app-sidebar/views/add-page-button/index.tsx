import type { DocMode } from '@blocksuite/affine/model';
import { Button, IconButton, Menu, MenuItem, MenuSub } from '@nota/component';
import { usePageHelper } from '@nota/core/blocksuite/block-suite-page-list/utils';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { DocsService } from '@nota/core/modules/doc';
import { EditorSettingService } from '@nota/core/modules/editor-setting';
import { TemplateDocService } from '@nota/core/modules/template-doc';
import { StarterTemplatesMenu } from '@nota/core/modules/template-doc/view/starter-templates-menu';
import { TemplateListMenuContentScrollable } from '@nota/core/modules/template-doc/view/template-list-menu';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { inferOpenMode } from '@nota/core/utils';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import track from '@nota/track';
import {
  IconChevronDown,
  IconFileDescription,
  IconFileText,
  IconPlus,
  IconShape2,
} from '@tabler/icons-react';
import clsx from 'clsx';
import type React from 'react';
import { type MouseEvent, useCallback } from 'react';

import * as styles from './index.css';

/**
 * @return a function to create a new doc, will duplicate the template doc if the page template is enabled
 */
const useNewDoc = () => {
  const workspaceService = useService(WorkspaceService);
  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;

  const currentWorkspace = workspaceService.workspace;
  const enablePageTemplate = useLiveData(
    templateDocService.setting.enablePageTemplate$
  );
  const pageTemplateDocId = useLiveData(
    templateDocService.setting.pageTemplateDocId$
  );

  const pageHelper = usePageHelper(currentWorkspace.docCollection);

  const createPage = useAsyncCallback(
    async (e?: MouseEvent, mode?: DocMode) => {
      if (enablePageTemplate && pageTemplateDocId) {
        const docId =
          await docsService.duplicateFromTemplate(pageTemplateDocId);
        workbench.openDoc(docId, { at: inferOpenMode(e) });
      } else {
        pageHelper.createPage(mode, { at: inferOpenMode(e) });
      }
    },
    [docsService, enablePageTemplate, pageHelper, pageTemplateDocId, workbench]
  );

  return createPage;
};

interface AddPageButtonProps {
  className?: string;
  style?: React.CSSProperties;
}

const sideBottom = { side: 'bottom' as const };
export function AddPageButton(props: AddPageButtonProps) {
  const editorSetting = useService(EditorSettingService);
  const newDocDefaultMode = useLiveData(
    editorSetting.editorSetting.settings$.selector(s => s.newDocDefaultMode)
  );

  return newDocDefaultMode === 'ask' ? (
    <AddPageWithAsk {...props} />
  ) : (
    <AddPageWithoutAsk {...props} />
  );
}

function AddPageWithAsk({ className, style }: AddPageButtonProps) {
  const t = useI18n();
  const createDoc = useNewDoc();
  const workbench = useService(WorkbenchService).workbench;
  const docsService = useService(DocsService);

  const createPage = useCallback(
    (e?: MouseEvent) => {
      createDoc(e, 'page');
      track.$.navigationPanel.$.createDoc();
      track.$.sidebar.newDoc.quickStart({ with: 'page' });
    },
    [createDoc]
  );
  const createEdgeless = useCallback(
    (e?: MouseEvent) => {
      createDoc(e, 'edgeless');
      track.$.navigationPanel.$.createDoc();
      track.$.sidebar.newDoc.quickStart({ with: 'edgeless' });
    },
    [createDoc]
  );

  const createDocFromTemplate = useAsyncCallback(
    async (templateId: string) => {
      const docId = await docsService.duplicateFromTemplate(templateId);
      workbench.openDoc(docId);
      track.$.sidebar.newDoc.quickStart({ with: 'template' });
    },
    [docsService, workbench]
  );

  return (
    <Menu
      items={
        <>
          <MenuItem
            prefixIcon={<IconFileText size={18} stroke={1.85} />}
            onClick={createPage}
            onAuxClick={createPage}
          >
            {t['Page']()}
          </MenuItem>
          <MenuItem
            prefixIcon={<IconShape2 size={18} stroke={1.85} />}
            onClick={createEdgeless}
            onAuxClick={createEdgeless}
          >
            {t['Edgeless']()}
          </MenuItem>
          <MenuSub
            triggerOptions={{
              prefixIcon: <IconFileDescription size={18} stroke={1.85} />,
            }}
            subContentOptions={{
              sideOffset: 16,
              className: styles.templateMenu,
            }}
            items={
              <TemplateListMenuContentScrollable
                onSelect={createDocFromTemplate}
              />
            }
          >
            {t['Template']()}
          </MenuSub>
          <StarterTemplatesMenu />
        </>
      }
    >
      <Button
        tooltip={t['New Page']()}
        tooltipOptions={sideBottom}
        data-testid="sidebar-new-page-with-ask-button"
        className={clsx([styles.withAskRoot, className])}
        style={style}
      >
        <div className={styles.withAskContent}>
          <IconPlus size={18} stroke={2.1} />
          <IconChevronDown size={14} stroke={2.1} />
        </div>
      </Button>
    </Menu>
  );
}

function AddPageWithoutAsk({ className, style }: AddPageButtonProps) {
  const createDoc = useNewDoc();

  const onClickNewPage = useCallback(
    (e?: MouseEvent) => {
      createDoc(e);
      track.$.navigationPanel.$.createDoc();
    },
    [createDoc]
  );

  const t = useI18n();

  return (
    <IconButton
      tooltip={t['New Page']()}
      tooltipOptions={sideBottom}
      data-testid="sidebar-new-page-button"
      style={style}
      className={clsx([styles.root, className])}
      size={16}
      onClick={onClickNewPage}
      onAuxClick={onClickNewPage}
    >
      <IconPlus size={18} stroke={2.1} />
    </IconButton>
  );
}
