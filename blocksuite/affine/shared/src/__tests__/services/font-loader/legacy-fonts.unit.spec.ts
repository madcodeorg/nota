import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FontFamily,
  FontFamilyList,
  FontFamilySchema,
} from '@blocksuite/affine-model';
import type { BlockStdScope } from '@blocksuite/std';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  AffineCanvasTextFonts,
  CommunityCanvasTextFonts,
} from '../../../services/font-loader/config.js';
import { FontLoaderService } from '../../../services/font-loader/font-loader-service.js';

const publicFonts = path.resolve(
  import.meta.dirname,
  '../../../../../../../packages/frontend/core/public/fonts'
);

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
});

describe('legacy canvas font compatibility', () => {
  test('resolves every default canvas font to an included local asset', () => {
    for (const font of AffineCanvasTextFonts) {
      expect(font.url).toMatch(/^\/fonts\//);
      expect(existsSync(path.join(publicFonts, path.basename(font.url)))).toBe(
        true
      );
    }
  });

  test('accepts persisted Satoshi values without offering the font for new content', () => {
    expect(FontFamilySchema.parse('blocksuite:surface:Satoshi')).toBe(
      FontFamily.Satoshi
    );
    expect(FontFamilyList.map(([font]) => font)).not.toContain(
      FontFamily.Satoshi
    );
    expect(FontFamilyList.map(([font]) => font)).toContain(FontFamily.Inter);
  });

  test.each([
    { name: 'bundled', fonts: AffineCanvasTextFonts },
    { name: 'community', fonts: CommunityCanvasTextFonts },
  ])(
    'maps every legacy weight and style to the corresponding $name Inter resource',
    ({ fonts }) => {
      const legacyFonts = fonts.filter(
        font => font.font === FontFamily.Satoshi
      );
      expect(legacyFonts).toHaveLength(6);
      for (const font of legacyFonts) {
        const inter = fonts.find(
          candidate =>
            candidate.font === FontFamily.Inter &&
            candidate.weight === font.weight &&
            candidate.style === font.style
        );
        expect(inter).toBeDefined();
        expect(font.url).toBe(inter?.url);
        expect(font.url).not.toContain('Satoshi');
      }
    }
  );

  test('loads legacy document faces from real bundled Inter files on the local path', () => {
    const sources: { family: string; source: string }[] = [];
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(family: string, source: string) {
          sources.push({ family, source });
        }
        load() {
          return Promise.resolve(this);
        }
      }
    );
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add, delete: remove },
    });
    const fonts = AffineCanvasTextFonts.filter(
      font => font.font === FontFamily.Satoshi
    ).map(font => {
      const filename = font.url.split('/').pop()!;
      const resource = path.join(publicFonts, filename);
      expect(existsSync(resource), resource).toBe(true);
      expect(readFileSync(resource).subarray(0, 4).toString()).toBe('wOF2');
      return { ...font, url: '/fonts/' + filename };
    });
    const loader = new FontLoaderService({} as BlockStdScope);
    loader.load(fonts);
    expect(add).toHaveBeenCalledTimes(6);
    expect(sources).toEqual(
      fonts.map(font => ({
        family: FontFamily.Satoshi,
        source: `url(${font.url})`,
      }))
    );
    loader.unmounted();
    expect(remove).toHaveBeenCalledTimes(6);
    expect(
      readdirSync(publicFonts).some(name => name.startsWith('Satoshi-'))
    ).toBe(false);
  });
});
