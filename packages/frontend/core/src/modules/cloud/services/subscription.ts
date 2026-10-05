import { OnEvent, Service } from '@nota/infra';
import { tracker } from '@nota/track';

import { Subscription } from '../entities/subscription';
import { AccountChanged } from '../events/account-changed';

@OnEvent(AccountChanged, e => e.onAccountChanged)
export class SubscriptionService extends Service {
  subscription = this.framework.createEntity(Subscription);

  constructor() {
    super();
    this.subscription.ai$
      .map(sub => !!sub)
      .distinctUntilChanged()
      .subscribe(ai => {
        tracker.people.set({
          ai,
        });
      });
    this.subscription.pro$
      .map(sub => !!sub)
      .distinctUntilChanged()
      .subscribe(pro => {
        tracker.people.set({
          pro,
        });
      });
  }

  private onAccountChanged() {
    this.subscription.revalidate();
  }
}
