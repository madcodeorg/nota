import type { LinkPreviewData } from '@blocksuite/affine/model';
import { DEFAULT_LINK_PREVIEW_ENDPOINT } from '@blocksuite/affine/shared/consts';
import {
  LinkPreviewCacheIdentifier,
  type LinkPreviewCacheProvider,
  LinkPreviewService,
  LinkPreviewServiceIdentifier,
} from '@blocksuite/affine/shared/services';
import { type ExtensionType } from '@blocksuite/affine/store';
import type { Container } from '@blocksuite/global/di';
import { apis } from '@nota/electron-api';
import type { FrameworkProvider } from '@nota/infra';

import { ServerService } from '../../../modules/cloud/services/server';

class AffineLinkPreviewService extends LinkPreviewService {
  constructor(endpoint: string, cache: LinkPreviewCacheProvider) {
    super(cache);
    this.setEndpoint(endpoint);
  }

  protected override readonly _fetchPreview = async (
    url: string,
    signal?: AbortSignal
  ): Promise<Partial<LinkPreviewData>> => {
    if (signal?.aborted) return {};
    if (BUILD_CONFIG.isElectron) {
      // The existing main-process bridge fetches the selected public page
      // directly and validates its address. No cloud preview proxy is needed.
      return (await apis?.ui.getBookmarkDataByLink(url)) ?? {};
    }
    return this._fetchStandardPreview(url, signal);
  };
}

/**
 * Patch the link preview service, set the endpoint and cache
 * @param framework
 * @returns
 */
export function patchLinkPreviewService(
  framework: FrameworkProvider
): ExtensionType {
  // get link preview service endpoint from server and BUILD_CONFIG
  let linkPreviewUrl: string;
  try {
    const server = framework.get(ServerService).server;
    linkPreviewUrl = new URL(
      BUILD_CONFIG.linkPreviewUrl || DEFAULT_LINK_PREVIEW_ENDPOINT,
      server.baseUrl
    ).toString();
  } catch (err) {
    console.error(
      'Invalid BUILD_CONFIG.linkPreviewUrl, falling back to default',
      err
    );
    linkPreviewUrl = DEFAULT_LINK_PREVIEW_ENDPOINT;
  }

  return {
    setup: (di: Container) => {
      di.override(LinkPreviewServiceIdentifier, provider => {
        return new AffineLinkPreviewService(
          linkPreviewUrl,
          provider.get(LinkPreviewCacheIdentifier)
        );
      });
    },
  };
}
