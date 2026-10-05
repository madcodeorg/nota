import type { LinkedWidgetConfig } from '@blocksuite/affine/widgets/linked-doc';
import { AtMenuConfigService } from '@nota/core/modules/at-menu-config/services';
import { type FrameworkProvider } from '@nota/infra';

export function createLinkedWidgetConfig(
  framework: FrameworkProvider
): Partial<LinkedWidgetConfig> | undefined {
  const service = framework.getOptional(AtMenuConfigService);
  if (!service) return;
  return service.getConfig();
}
