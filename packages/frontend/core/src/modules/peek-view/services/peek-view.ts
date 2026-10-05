import { OnEvent, Service } from '@nota/infra';

import { WorkbenchLocationChanged } from '../../workbench/services/workbench';
import { PeekViewEntity } from '../entities/peek-view';

@OnEvent(WorkbenchLocationChanged, e => () => e.peekView.close())
export class PeekViewService extends Service {
  public readonly peekView = this.framework.createEntity(PeekViewEntity);
}
