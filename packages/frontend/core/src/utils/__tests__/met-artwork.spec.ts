// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { MetObjectResponse } from '../met-artwork';

const painting = (objectID: number, extra: Partial<MetObjectResponse> = {}) =>
  ({
    artistDisplayName: 'Claude Monet',
    classification: 'Paintings',
    isPublicDomain: true,
    objectDate: '1899',
    objectID,
    objectURL: `https://www.metmuseum.org/art/collection/search/${objectID}`,
    primaryImageSmall: `https://images.metmuseum.org/${objectID}.jpg`,
    title: `Painting ${objectID}`,
    ...extra,
  }) satisfies MetObjectResponse;

const objects: Record<number, MetObjectResponse> = {
  1: painting(1),
  2: painting(2, { isPublicDomain: false }),
  3: painting(3, { primaryImageSmall: '', primaryImage: '' }),
  4: painting(4, { classification: 'Prints', medium: 'Etching' }),
};

const fetchMock = vi.fn(async (url: string) => {
  const { pathname } = new URL(url);
  if (pathname.endsWith('/v1.1/search')) {
    return Response.json({ total: 4, objectIDs: [1, 2, 3, 4] });
  }
  const id = Number(pathname.split('/').pop());
  return objects[id]
    ? Response.json(objects[id])
    : new Response(null, { status: 404 });
});

const loadModule = () => import('../met-artwork');

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('loadArtworkPool', () => {
  test('builds the pool from public-domain paintings via the v1.1 search', async () => {
    const { loadArtworkPool } = await loadModule();

    const pool = await loadArtworkPool();

    expect(pool.map(artwork => artwork.objectId)).toEqual([1]);
    expect(pool[0]).toMatchObject({
      artist: 'Claude Monet',
      sourceUrl: 'https://www.metmuseum.org/art/collection/search/1',
      title: 'Painting 1',
    });
    const searchUrls = fetchMock.mock.calls
      .map(([url]) => url)
      .filter(url => url.includes('/search'));
    expect(searchUrls.length).toBeGreaterThan(0);
    for (const url of searchUrls) {
      expect(url).toContain('/public/collection/v1.1/search?');
      expect(url).toContain('limit=500');
    }
  });

  test('reuses the cached pool without refetching', async () => {
    const first = await loadModule();
    await first.loadArtworkPool();
    fetchMock.mockClear();

    vi.resetModules();
    const second = await loadModule();
    const pool = await second.loadArtworkPool();

    expect(pool.map(artwork => artwork.objectId)).toEqual([1]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('falls back to the expired pool when the API is unreachable', async () => {
    const first = await loadModule();
    await first.loadArtworkPool();

    vi.useFakeTimers({ now: Date.now() + 1000 * 60 * 60 * 25 });
    vi.resetModules();
    fetchMock.mockRejectedValue(new Error('offline'));
    const second = await loadModule();

    const pool = await second.loadArtworkPool();

    expect(pool.map(artwork => artwork.objectId)).toEqual([1]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test('rejects when nothing is cached and the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { loadArtworkPool } = await loadModule();

    await expect(loadArtworkPool()).rejects.toThrow();
  });
});

describe('pickFreshArtwork', () => {
  test('avoids the current artwork and the previous pick', async () => {
    const { normalizeMetArtwork, pickFreshArtwork } = await loadModule();
    const [a, b, c] = [1, 5, 6].map(id => normalizeMetArtwork(painting(id))!);

    const first = pickFreshArtwork([a, b, c], a);
    expect(first).not.toBe(a);

    const second = pickFreshArtwork([a, b, c], a);
    expect(second).not.toBe(a);
    expect(second).not.toBe(first);
  });

  test('uses the bundled artwork when the pool is empty', async () => {
    const { DEFAULT_ARTWORK, pickFreshArtwork } = await loadModule();

    expect(pickFreshArtwork([])).toBe(DEFAULT_ARTWORK);
  });
});
