import { afterEach, describe, expect, test, vi } from 'vitest';

import { GalleryImageCache } from '../view-presets/gallery/image-utils.js';

const files = (...items: { id: string; mime?: string }[]) =>
  Object.fromEntries(
    items.map((item, index) => [
      item.id,
      { ...item, name: item.id, order: String(index) },
    ])
  );
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('gallery attachment cover lifecycle', () => {
  test('retries an unchanged missing cover with backoff and on reconnect, and cancels retries on close', async () => {
    vi.useFakeTimers();
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:arrived');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const get = vi.fn<() => Promise<Blob | null>>().mockResolvedValue(null);
    const changed = vi.fn();
    const cache = new GalleryImageCache(get, changed);
    const value = files({ id: 'remote-image', mime: 'image/png' });
    cache.source(value);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20; i++) cache.source(value);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(get).toHaveBeenCalledTimes(2);
    get.mockResolvedValue(new Blob(['arrived'], { type: 'image/png' }));
    cache.retryUnavailable();
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.source(value)).toBe('blob:arrived');
    expect(changed).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    cache.dispose();
    await vi.advanceTimersByTimeAsync(120000);
    expect(get).toHaveBeenCalledTimes(3);
  });

  test('uses the first supported local image and releases URLs when cards disappear or disconnect', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:gallery-cover');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const blob = new Blob(['image bytes'], { type: 'image/png' });
    const get = vi.fn(async (id: string) => (id === 'image' ? blob : null));
    const changed = vi.fn();
    const cache = new GalleryImageCache(get, changed);
    const attachments = files(
      { id: 'pdf', mime: 'application/pdf' },
      { id: 'missing', mime: 'image/jpeg' },
      { id: 'image', mime: 'image/png' }
    );
    expect(cache.source(attachments)).toBeUndefined();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(get.mock.calls.map(([id]) => id)).toEqual(['missing', 'image']);
    expect(cache.source(attachments)).toBe('blob:gallery-cover');
    expect(create).toHaveBeenCalledExactlyOnceWith(blob);
    cache.retain([attachments]);
    expect(revoke).not.toHaveBeenCalled();
    cache.retain([]);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:gallery-cover');
    expect(cache.source(attachments)).toBeUndefined();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    cache.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  test('ignores a late image after final close and mismatched MIME without breaking rows', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:late');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    let finish!: (blob: Blob | null) => void;
    const pending = new Promise<Blob | null>(resolve => {
      finish = resolve;
    });
    const changed = vi.fn();
    const cache = new GalleryImageCache(() => pending, changed);
    cache.source(files({ id: 'late', mime: 'image/png' }));
    cache.dispose();
    finish(new Blob(['late'], { type: 'image/png' }));
    await pending;
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    const invalid = new GalleryImageCache(
      async () => new Blob(['<html>'], { type: 'text/html' }),
      changed
    );
    expect(
      invalid.source(files({ id: 'html', mime: 'image/png' }))
    ).toBeUndefined();
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
    invalid.dispose();
  });

  test('does not revoke supplied URLs and reloads covers when attachment selection changes', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const changed = vi.fn();
    const cache = new GalleryImageCache(
      async () => new Blob(['image'], { type: 'image/webp' }),
      changed
    );
    expect(cache.source('blob:existing')).toBe('blob:existing');
    const first = files({ id: 'first' });
    cache.source(first);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const second = files({ id: 'second', mime: 'image/webp' });
    cache.retain([second]);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
    cache.source(second);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(cache.source(second)).toBe('blob:second');
    expect(create).toHaveBeenCalledTimes(2);
    cache.dispose();
    expect(revoke).toHaveBeenLastCalledWith('blob:second');
    expect(revoke.mock.calls.some(([url]) => url === 'blob:existing')).toBe(
      false
    );
  });
});
