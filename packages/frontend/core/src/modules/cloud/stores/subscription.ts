import { subscriptionQuery } from '@nota/graphql';
import { Store } from '@nota/infra';

import type { GlobalCache } from '../../storage';
import type { SubscriptionType } from '../entities/subscription';
import type { GraphQLService } from '../services/graphql';

const SUBSCRIPTION_CACHE_KEY = 'subscription:';

export class SubscriptionStore extends Store {
  constructor(
    private readonly gqlService: GraphQLService,
    private readonly globalCache: GlobalCache
  ) {
    super();
  }

  async fetchSubscriptions(abortSignal?: AbortSignal) {
    const data = await this.gqlService.gql({
      query: subscriptionQuery,
      context: { signal: abortSignal },
    });
    if (!data.currentUser) {
      throw new Error('No logged in');
    }
    return {
      userId: data.currentUser.id,
      subscriptions: data.currentUser.subscriptions,
    };
  }

  getCachedSubscriptions(userId: string) {
    return this.globalCache.get<SubscriptionType[]>(
      SUBSCRIPTION_CACHE_KEY + userId
    );
  }

  setCachedSubscriptions(userId: string, subscriptions: SubscriptionType[]) {
    return this.globalCache.set(SUBSCRIPTION_CACHE_KEY + userId, subscriptions);
  }
}
