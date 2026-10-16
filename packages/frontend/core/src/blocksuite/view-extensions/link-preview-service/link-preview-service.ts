import type { LinkPreviewData } from '@blocksuite/affine/model';
import {
  LinkPreviewCacheIdentifier,
  type LinkPreviewCacheProvider,
  LinkPreviewService,
  LinkPreviewServiceIdentifier,
} from '@blocksuite/affine/shared/services';
import { type ExtensionType } from '@blocksuite/affine/store';
import type { Container } from '@blocksuite/global/di';
import { apis } from '@nota/electron-api';

class NotaLinkPreviewService extends LinkPreviewService {
  constructor(cache: LinkPreviewCacheProvider) {
    super(cache);
  }

  protected override readonly _fetchPreview = async (
    url: string,
    signal?: AbortSignal
  ): Promise<Partial<LinkPreviewData>> => {
    if (signal?.aborted || !BUILD_CONFIG.isElectron) return {};
    // The main-process bridge fetches the public page directly and validates
    // its address. Other platforms have no preview service, so links stay
    // plain instead of being sent to a remote proxy.
    return (await apis?.ui.getBookmarkDataByLink(url)) ?? {};
  };
}

export function patchLinkPreviewService(): ExtensionType {
  return {
    setup: (di: Container) => {
      di.override(LinkPreviewServiceIdentifier, provider => {
        return new NotaLinkPreviewService(
          provider.get(LinkPreviewCacheIdentifier)
        );
      });
    },
  };
}
