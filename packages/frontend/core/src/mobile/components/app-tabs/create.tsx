import { EditIcon } from '@blocksuite/icons/rc';
import { usePageHelper } from '@nota/core/blocksuite/block-suite-page-list/utils';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { DocsService } from '@nota/core/modules/doc';
import { TemplateDocService } from '@nota/core/modules/template-doc';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useLiveData, useService } from '@nota/infra';
import track from '@nota/track';

import { TabItem } from './tab-item';
import type { AppTabCustomFCProps } from './type';

export const AppTabCreate = ({ tab }: AppTabCustomFCProps) => {
  const workbench = useService(WorkbenchService).workbench;
  const workspaceService = useService(WorkspaceService);
  const templateDocService = useService(TemplateDocService);
  const docsService = useService(DocsService);

  const currentWorkspace = workspaceService.workspace;
  const pageHelper = usePageHelper(currentWorkspace.docCollection);
  const enablePageTemplate = useLiveData(
    templateDocService.setting.enablePageTemplate$
  );
  const pageTemplateDocId = useLiveData(
    templateDocService.setting.pageTemplateDocId$
  );

  const createPage = useAsyncCallback(
    async (isActive: boolean) => {
      if (isActive) return;
      if (enablePageTemplate && pageTemplateDocId) {
        const docId =
          await docsService.duplicateFromTemplate(pageTemplateDocId);
        workbench.openDoc({ docId, fromTab: 'true' });
      } else {
        const doc = pageHelper.createPage(undefined, { show: false });
        workbench.openDoc({ docId: doc.id, fromTab: 'true' });
      }
      track.$.navigationPanel.$.createDoc();
    },
    [docsService, enablePageTemplate, pageHelper, pageTemplateDocId, workbench]
  );

  return (
    <TabItem id={tab.key} onClick={createPage} label="New Page">
      <EditIcon />
    </TabItem>
  );
};
