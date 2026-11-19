import { describe, expect, test } from 'vitest';

import {
  clampCoverPositionY,
  COVER_PRESETS,
  DEFAULT_COVER_POSITION_Y,
  isPageCoverCustom,
  isPageFontStyle,
  isValidCoverUrl,
  MAX_COVER_UPLOAD_BYTES,
  validateCoverImageFile,
} from './page-cover';

describe('page cover and style helpers', () => {
  test('validates per-page font styles', () => {
    expect(isPageFontStyle('default')).toBe(true);
    expect(isPageFontStyle('Sans')).toBe(true);
    expect(isPageFontStyle('Serif')).toBe(true);
    expect(isPageFontStyle('Mono')).toBe(true);
    expect(isPageFontStyle('ComicSans')).toBe(false);
    expect(isPageFontStyle(undefined)).toBe(false);
  });

  test('clamps vertical cover position safely', () => {
    expect(clampCoverPositionY(undefined)).toBe(DEFAULT_COVER_POSITION_Y);
    expect(clampCoverPositionY(Number.NaN)).toBe(DEFAULT_COVER_POSITION_Y);
    expect(clampCoverPositionY(-12)).toBe(0);
    expect(clampCoverPositionY(145)).toBe(100);
    expect(clampCoverPositionY(63.6)).toBe(64);
  });

  test('accepts only https image URLs for custom covers', () => {
    expect(isValidCoverUrl('https://images.example.com/hero.jpg')).toBe(true);
    expect(isValidCoverUrl('http://images.example.com/hero.jpg')).toBe(false);
    expect(isValidCoverUrl('javascript:alert(1)')).toBe(false);
    expect(isValidCoverUrl('data:image/png;base64,abc')).toBe(false);
    expect(isValidCoverUrl('https://')).toBe(false);
  });

  test('validates persisted custom cover descriptors', () => {
    expect(isPageCoverCustom({ kind: 'artwork' })).toBe(true);
    expect(
      isPageCoverCustom({
        kind: 'gradient',
        label: COVER_PRESETS[0].label,
        value: COVER_PRESETS[0].value,
      })
    ).toBe(true);
    expect(isPageCoverCustom({ kind: 'blob', blobId: 'blob-123' })).toBe(true);
    expect(
      isPageCoverCustom({
        kind: 'url',
        url: 'https://cdn.example.com/banner.webp',
      })
    ).toBe(true);

    expect(isPageCoverCustom({ kind: 'blob', blobId: '' })).toBe(false);
    expect(
      isPageCoverCustom({ kind: 'url', url: 'http://insecure.example/a.png' })
    ).toBe(false);
    expect(isPageCoverCustom({ kind: 'unknown' })).toBe(false);
    expect(isPageCoverCustom(null)).toBe(false);
  });

  test('validates uploaded cover files against allowed raster types and size cap', () => {
    expect(validateCoverImageFile({ type: 'image/png', size: 1024 })).toEqual({
      ok: true,
    });
    expect(
      validateCoverImageFile({
        type: 'image/webp',
        size: MAX_COVER_UPLOAD_BYTES,
      })
    ).toEqual({ ok: true });
    expect(
      validateCoverImageFile({ type: 'image/svg+xml', size: 512 }).ok
    ).toBe(false);
    expect(
      validateCoverImageFile({ type: 'application/pdf', size: 512 }).ok
    ).toBe(false);
    expect(
      validateCoverImageFile({
        type: 'image/jpeg',
        size: MAX_COVER_UPLOAD_BYTES + 1,
      }).ok
    ).toBe(false);
    expect(validateCoverImageFile({ type: 'image/png', size: 0 }).ok).toBe(
      false
    );
  });
});
