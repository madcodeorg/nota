/** Existing Image properties contain image URLs, not attachment/blob records. */
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
