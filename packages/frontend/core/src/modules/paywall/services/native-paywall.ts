import { Service } from '@nota/infra';

import { NativePaywallProvider } from '../providers/native-paywall';

export class NativePaywallService extends Service {
  constructor() {
    super();
  }

  getNativePaywallProvider() {
    return this.framework.getOptional(NativePaywallProvider);
  }
}
