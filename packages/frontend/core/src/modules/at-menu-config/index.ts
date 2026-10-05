import { type Framework } from '@nota/infra';

import { WorkspaceDialogService } from '../dialogs';
import { DocScope, DocsService } from '../doc';
import { DocDisplayMetaService } from '../doc-display-meta';
import { JournalService } from '../journal';
import { SearchMenuService } from '../search-menu/services';
import { WorkspaceScope } from '../workspace';
import { AtMenuConfigService } from './services';

export function configAtMenuConfigModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .scope(DocScope)
    .service(AtMenuConfigService, [
      JournalService,
      DocDisplayMetaService,
      WorkspaceDialogService,
      DocsService,
      SearchMenuService,
    ]);
}
