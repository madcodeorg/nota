import { Service } from '@nota/infra';

import { UnusedBlobs } from '../entity/unused-blobs';

export class BlobManagementService extends Service {
  constructor() {
    super();
  }

  unusedBlobs = this.framework.createEntity(UnusedBlobs);
}
