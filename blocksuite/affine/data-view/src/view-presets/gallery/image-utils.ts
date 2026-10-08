/** Image properties retain their URL representation; attachments stay blob IDs. */
export function galleryImageSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const source = value.trim();
  if (
    /^(https?:\/\/|blob:|data:image\/(png|jpe?g|webp|gif|avif);base64,)/i.test(
      source
    )
  )
    return source;
  return;
}

const imageMimeTypes = new Set([
  'image/apng',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/vnd.microsoft.icon',
]);

type Attachment = { id: string; order: string; mime?: string };
function attachments(value: unknown): Attachment[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value)
    .filter(
      (item): item is Attachment =>
        !!item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.order === 'string' &&
        (item.mime == null || typeof item.mime === 'string')
    )
    .sort((a, b) => a.order.localeCompare(b.order));
}

type Cover = {
  source?: string;
  active: boolean;
  loading: boolean;
  attempts: number;
  items: Attachment[];
  retry?: ReturnType<typeof setTimeout>;
};

/** Own URLs only for visible cards; late requests never retain detached media. */
export class GalleryImageCache {
  private readonly covers = new Map<string, Cover>();

  constructor(
    private readonly getBlob: (id: string) => Promise<Blob | null>,
    private readonly changed: () => void
  ) {}

  private key(value: unknown): string {
    return JSON.stringify(attachments(value));
  }

  source(value: unknown): string | undefined {
    const url = galleryImageSource(value);
    if (url) return url;
    const items = attachments(value);
    if (!items.length) return;
    const key = this.key(value);
    const cached = this.covers.get(key);
    if (cached) return cached.source;
    const cover: Cover = { active: true, loading: false, attempts: 0, items };
    this.covers.set(key, cover);
    this.load(cover);
    return;
  }

  private load(cover: Cover): void {
    if (!cover.active || cover.loading || cover.source) return;
    clearTimeout(cover.retry);
    cover.retry = undefined;
    cover.loading = true;
    cover.attempts++;
    void this.resolve(cover)
      .finally(() => {
        cover.loading = false;
      })
      .catch(() => {});
  }

  private async resolve(cover: Cover): Promise<void> {
    let unavailable = false;
    for (const item of cover.items) {
      if (!cover.active) return;
      if (item.mime && !imageMimeTypes.has(item.mime.toLowerCase())) continue;
      let blob: Blob | null;
      try {
        blob = await this.getBlob(item.id);
      } catch {
        unavailable = true;
        continue;
      }
      if (!cover.active) return;
      if (!blob) {
        unavailable = true;
        continue;
      }
      if (!imageMimeTypes.has((blob.type || item.mime || '').toLowerCase()))
        continue;
      cover.source = URL.createObjectURL(blob);
      this.changed();
      return;
    }
    if (cover.active && unavailable) {
      // Media may arrive later through optional sync. Keep retries independent
      // of render frequency, and stop them as soon as the card leaves the view.
      cover.retry = setTimeout(
        () => this.load(cover),
        Math.min(60000, cover.attempts * 10000)
      );
    }
  }

  retryUnavailable(): void {
    this.covers.forEach(cover => this.load(cover));
  }

  retain(values: unknown[]): void {
    const retained = new Set(values.map(value => this.key(value)));
    for (const [key, cover] of this.covers) {
      if (retained.has(key)) continue;
      cover.active = false;
      clearTimeout(cover.retry);
      if (cover.source) URL.revokeObjectURL(cover.source);
      this.covers.delete(key);
    }
  }

  dispose(): void {
    this.retain([]);
  }
}
