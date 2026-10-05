import { NativeClipboardExtension } from '@blocksuite/affine/shared/services';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import type { FrameworkProvider } from '@nota/infra';

export function patchForClipboardInElectron(framework: FrameworkProvider) {
  const desktopApi = framework.get(DesktopApiService);
  return NativeClipboardExtension({
    copyAsPNG: desktopApi.handler.clipboard.copyAsPNG,
  });
}
