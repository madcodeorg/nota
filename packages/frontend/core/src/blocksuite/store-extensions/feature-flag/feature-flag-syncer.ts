import { FeatureFlagService as BSFeatureFlagService } from '@blocksuite/affine/shared/services';
import { type ExtensionType, StoreExtension } from '@blocksuite/affine/store';
import {
  AFFINE_FLAGS,
  type FeatureFlagService,
} from '@nota/core/modules/feature-flag';

export function getFeatureFlagSyncer(
  featureFlagService: FeatureFlagService
): ExtensionType {
  class FeatureFlagSyncer extends StoreExtension {
    static override key = 'feature-flag-syncer';

    override loaded() {
      const bsFeatureFlagService = this.store.get(BSFeatureFlagService);
      Object.entries(AFFINE_FLAGS).forEach(([key, flag]) => {
        if (flag.category === 'blocksuite') {
          const value =
            featureFlagService.flags[key as keyof AFFINE_FLAGS].value;
          if (value !== undefined) {
            bsFeatureFlagService.setFlag(flag.bsFlag, value);
          }
        }
      });
    }
  }

  return FeatureFlagSyncer;
}
