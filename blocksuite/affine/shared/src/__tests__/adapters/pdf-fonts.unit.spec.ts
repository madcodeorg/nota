import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import pdfMake from 'pdfmake/build/pdfmake';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  loadBundledPdfFonts,
  PDF_FONT_URLS,
  PDF_FONTS,
} from '../../adapters/pdf/fonts.js';

afterEach(() => vi.unstubAllGlobals());

describe('bundled PDF fonts', () => {
  test('exports Latin and CJK text without fetching an external font service', async () => {
    const fetchFont = vi.fn(async (url: string) => {
      expect(new URL(url).host).toBe(location.host);
      const fontPath = path.resolve(
        import.meta.dirname,
        '../../adapters/pdf/fonts',
        path.basename(new URL(url).pathname)
      );
      expect(existsSync(fontPath)).toBe(true);
      return {
        ok: true,
        blob: async () => new Blob([new Uint8Array(readFileSync(fontPath))]),
      };
    });
    vi.stubGlobal('fetch', fetchFont);
    expect(PDF_FONT_URLS).toHaveLength(5);

    const fonts = await loadBundledPdfFonts();
    const cached = await loadBundledPdfFonts();
    expect(cached).toBe(fonts);
    expect(fetchFont).toHaveBeenCalledTimes(5);

    const pdf = pdfMake.createPdf(
      {
        content: [
          'Nota 中文 日本語 한국어',
          { text: 'Local code font', font: 'Inter' },
        ],
        defaultStyle: { font: 'SarasaGothicCL' },
      },
      undefined,
      PDF_FONTS,
      fonts
    );
    const buffer = await new Promise<Buffer>(resolve => pdf.getBuffer(resolve));
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
