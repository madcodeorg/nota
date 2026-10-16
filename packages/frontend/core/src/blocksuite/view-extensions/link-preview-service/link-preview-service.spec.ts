import type { LinkPreviewProvider } from '@blocksuite/affine/shared/services';
import type { Container } from '@blocksuite/global/di';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { patchLinkPreviewService } from './link-preview-service';

const bridge = vi.hoisted(() => ({ getBookmarkDataByLink: vi.fn() }));
vi.mock('@nota/electron-api', () => ({ apis: { ui: bridge } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  bridge.getBookmarkDataByLink.mockReset();
});

function createPreviewService() {
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    getPendingRequest: vi.fn(),
    setPendingRequest: vi.fn(),
    deletePendingRequest: vi.fn(),
  };
  let service!: LinkPreviewProvider;
  patchLinkPreviewService().setup!({
    override: (
      _identifier: unknown,
      factory: (provider: unknown) => LinkPreviewProvider
    ) => {
      service = factory({ get: () => cache });
    },
  } as unknown as Container);
  return service;
}

describe('Nota link previews', () => {
  it('uses the existing desktop bridge instead of transmitting URLs to an upstream proxy', async () => {
    vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, isElectron: true });
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    bridge.getBookmarkDataByLink.mockResolvedValue({ title: 'Local preview' });

    const result = await createPreviewService().query(
      'https://example.com/private-path'
    );

    expect(result).toEqual({ title: 'Local preview' });
    expect(bridge.getBookmarkDataByLink).toHaveBeenCalledWith(
      'https://example.com/private-path'
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('makes no network request outside the desktop app', async () => {
    vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, isElectron: false });
    const network = vi.fn();
    vi.stubGlobal('fetch', network);

    expect(
      await createPreviewService().query('https://example.com/private-path')
    ).toEqual({});
    expect(network).not.toHaveBeenCalled();
    expect(bridge.getBookmarkDataByLink).not.toHaveBeenCalled();
  });

  it('does not request a preview for an aborted operation', async () => {
    vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, isElectron: true });
    const signal = AbortSignal.abort();
    expect(
      await createPreviewService().query('https://example.com', signal)
    ).toEqual({});
    expect(bridge.getBookmarkDataByLink).not.toHaveBeenCalled();
  });
});
