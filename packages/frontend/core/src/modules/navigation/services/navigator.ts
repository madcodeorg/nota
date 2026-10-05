import { Service } from '@nota/infra';

import { Navigator } from '../entities/navigator';

export class NavigatorService extends Service {
  public readonly navigator = this.framework.createEntity(Navigator);
}
