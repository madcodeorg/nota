import { Service } from '@nota/infra';

import type { WorkspaceService } from '../../workspace';
import { isServerBackedWorkspaceFlavour } from '../../workspace/metadata';
import { ShareDocsList } from '../entities/share-docs-list';

export class ShareDocsListService extends Service {
  constructor(private readonly workspaceService: WorkspaceService) {
    super();
  }

  shareDocs = isServerBackedWorkspaceFlavour(
    this.workspaceService.workspace.flavour
  )
    ? this.framework.createEntity(ShareDocsList)
    : null;

  override dispose(): void {
    this.shareDocs?.dispose();
  }
}
