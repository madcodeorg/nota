import { Service } from '@nota/infra';

import { WorkspaceQuota } from '../entities/quota';

export class WorkspaceQuotaService extends Service {
  quota = this.framework.createEntity(WorkspaceQuota);

  override dispose(): void {
    this.quota.dispose();
  }
}
