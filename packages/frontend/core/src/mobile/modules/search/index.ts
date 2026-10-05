import { WorkspaceScope } from '@nota/core/modules/workspace';
import { type Framework } from '@nota/infra';

import { MobileSearchService } from './service/search';

export { MobileSearchService };

export function configureMobileSearchModule(framework: Framework) {
  framework.scope(WorkspaceScope).service(MobileSearchService);
}
