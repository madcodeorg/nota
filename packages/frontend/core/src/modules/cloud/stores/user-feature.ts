import { getCurrentUserProfileQuery } from '@nota/graphql';
import { Store } from '@nota/infra';

import type { GraphQLService } from '../services/graphql';

export class UserFeatureStore extends Store {
  constructor(private readonly gqlService: GraphQLService) {
    super();
  }

  async getUserFeatures(signal: AbortSignal) {
    const data = await this.gqlService.gql({
      query: getCurrentUserProfileQuery,
      context: {
        signal,
      },
    });
    return {
      userId: data.currentUser?.id,
      features: data.currentUser?.features,
    };
  }
}
