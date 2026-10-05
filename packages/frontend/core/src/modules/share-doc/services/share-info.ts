import { Service } from '@nota/infra';

import { ShareInfo } from '../entities/share-info';

export class ShareInfoService extends Service {
  shareInfo = this.framework.createEntity(ShareInfo);
}
