import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadFonts: vi.fn(() => vi.fn()),
  setCompilerInitOptions: vi.fn(),
  setRendererInitOptions: vi.fn(),
}));

vi.mock('@myriaddreamin/typst.ts', () => ({
  loadFonts: mocks.loadFonts,
  $typst: {
    setCompilerInitOptions: mocks.setCompilerInitOptions,
    setRendererInitOptions: mocks.setRendererInitOptions,
  },
}));

import { ensureTypstReady, TYPST_FONT_URLS } from './typst';

describe('offline Typst fonts', () => {
  it('initializes preview fonts from shipped files instead of a remote CDN', async () => {
    for (const url of TYPST_FONT_URLS) {
      expect(url).not.toMatch(/^https?:/);
      expect(existsSync(fileURLToPath(url))).toBe(true);
    }

    await ensureTypstReady();

    expect(mocks.loadFonts).toHaveBeenCalledWith([...TYPST_FONT_URLS]);
    expect(mocks.setCompilerInitOptions).toHaveBeenCalledOnce();
    expect(mocks.setRendererInitOptions).toHaveBeenCalledOnce();
  });
});
