import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const core = new URL('../../../../core/src/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, core), 'utf8');

describe('removed upstream checkout integration', () => {
  test('does not wire checkout into either AI peek-view layer', () => {
    for (const path of [
      'blocksuite/ai/peek-view/chat-block-peek-view.ts',
      'modules/peek-view/view/ai-chat-block-peek-view/index.tsx',
    ]) {
      expect(source(path)).not.toMatch(
        /SubscriptionService|onAISubscribe|useAISubscribe/
      );
    }
  });

  test('keeps subscription status compatibility without billing mutations', () => {
    const store = source('modules/cloud/stores/subscription.ts');
    expect(store).toContain('subscriptionQuery');
    expect(store).toContain('getCachedSubscriptions');
    expect(store).not.toMatch(/Mutation|createCheckoutSession|pricesQuery/);
    expect(source('modules/cloud/index.ts')).not.toContain(
      'SubscriptionPrices'
    );
  });

  test('removes checkout and survey helper modules', () => {
    for (const path of [
      'components/hooks/nota/use-ai-subscribe.ts',
      'components/hooks/nota/use-subscription-notify.tsx',
      'modules/cloud/entities/subscription-prices.ts',
    ]) {
      expect(existsSync(new URL(path, core))).toBe(false);
    }
  });
});
