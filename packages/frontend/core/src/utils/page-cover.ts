import { isHttpsUrl } from './met-artwork';

export type PageFontStyle = 'default' | 'Sans' | 'Serif' | 'Mono';

export type PageCoverCustom =
  | { kind: 'artwork' }
  | { kind: 'gradient'; value: string; label: string }
  | { kind: 'blob'; blobId: string }
  | { kind: 'url'; url: string };

export interface PageCoverPreset {
  id: string;
  label: string;
  value: string;
}

export const DEFAULT_COVER_POSITION_Y = 40;
export const MAX_COVER_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

const ALLOWED_COVER_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const COVER_PRESETS: readonly PageCoverPreset[] = [
  {
    id: 'warm-paper',
    label: 'Warm Linen',
    value: 'linear-gradient(135deg, #f3e7d3 0%, #e5c9a6 55%, #d6ab82 100%)',
  },
  {
    id: 'olive-grove',
    label: 'Olive Mist',
    value: 'linear-gradient(135deg, #dce4d0 0%, #a5b68d 52%, #6d8159 100%)',
  },
  {
    id: 'graphite-coral',
    label: 'Graphite Coral',
    value: 'linear-gradient(135deg, #2b2d34 0%, #6b4349 52%, #df6d59 100%)',
  },
  {
    id: 'ocean-glass',
    label: 'Ocean Glass',
    value: 'linear-gradient(135deg, #d7ecfa 0%, #7bb4d8 52%, #396894 100%)',
  },
  {
    id: 'terracotta',
    label: 'Terracotta',
    value: 'linear-gradient(135deg, #f2ccb7 0%, #d47b59 55%, #8f3f2d 100%)',
  },
  {
    id: 'midnight-ink',
    label: 'Midnight Ink',
    value: 'linear-gradient(135deg, #161925 0%, #2c3554 55%, #4a5a8a 100%)',
  },
  {
    id: 'lavender-haze',
    label: 'Lavender Haze',
    value: 'linear-gradient(135deg, #ede4f7 0%, #bfa6dc 55%, #7c63a6 100%)',
  },
  {
    id: 'golden-hour',
    label: 'Golden Hour',
    value: 'linear-gradient(135deg, #fde8b8 0%, #f1b664 55%, #cc7246 100%)',
  },
  {
    id: 'forest-canopy',
    label: 'Forest Canopy',
    value: 'linear-gradient(135deg, #1b3127 0%, #2f5946 55%, #5c8a72 100%)',
  },
  {
    id: 'slate-stone',
    label: 'Slate Stone',
    value: 'linear-gradient(135deg, #e2e6ec 0%, #a8b3c2 55%, #657184 100%)',
  },
  {
    id: 'rose-quartz',
    label: 'Rose Quartz',
    value: 'linear-gradient(135deg, #fae2e5 0%, #e4a6b1 55%, #b56576 100%)',
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    value: '#1c1d21',
  },
];

export function isPageFontStyle(value: unknown): value is PageFontStyle {
  return (
    value === 'default' ||
    value === 'Sans' ||
    value === 'Serif' ||
    value === 'Mono'
  );
}

export function clampCoverPositionY(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_COVER_POSITION_Y;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function isValidCoverUrl(value: unknown): value is string {
  if (!isHttpsUrl(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isPageCoverCustom(value: unknown): value is PageCoverCustom {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const cover = value as Partial<PageCoverCustom>;
  switch (cover.kind) {
    case 'artwork':
      return true;
    case 'gradient':
      return (
        typeof cover.value === 'string' &&
        cover.value.length > 0 &&
        cover.value.length <= 300 &&
        typeof cover.label === 'string'
      );
    case 'blob':
      return typeof cover.blobId === 'string' && cover.blobId.length > 0;
    case 'url':
      return isValidCoverUrl(cover.url);
    default:
      return false;
  }
}

export function validateCoverImageFile(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  const normalizedType = file.type.toLowerCase();
  if (!ALLOWED_COVER_IMAGE_TYPES.has(normalizedType)) {
    return {
      ok: false,
      error: 'Choose a PNG, JPG, WebP, GIF, or AVIF image.',
    };
  }
  if (file.size <= 0 || file.size > MAX_COVER_UPLOAD_BYTES) {
    return {
      ok: false,
      error: 'Cover image must be under 10 MB.',
    };
  }
  return { ok: true };
}
