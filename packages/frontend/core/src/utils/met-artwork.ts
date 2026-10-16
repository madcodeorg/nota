export type Artwork = {
  artist: string;
  date: string;
  imageUrl: string;
  objectId?: number;
  sourceUrl?: string;
  title: string;
};

type MetSearchResponse = {
  objectIDs?: number[] | null;
  total: number;
};

export type MetObjectResponse = {
  artistDisplayName?: string;
  classification?: string;
  isPublicDomain?: boolean;
  medium?: string;
  objectDate?: string;
  objectID?: number;
  objectName?: string;
  objectURL?: string;
  primaryImage?: string;
  primaryImageSmall?: string;
  title?: string;
};

type ArtworkPool = {
  artworks: Artwork[];
  fetchedAt: number;
};

export const DEFAULT_ARTWORK: Artwork = {
  artist: 'Vincent van Gogh',
  date: '1889',
  imageUrl:
    'https://images.metmuseum.org/CRDImages/ep/web-large/DP-42549-001.jpg',
  objectId: 436535,
  sourceUrl: 'https://www.metmuseum.org/art/collection/search/436535',
  title: 'Wheat Field with Cypresses',
};

// The unpaginated /v1/search endpoint was retired on 2026-10-01 (HTTP 410).
const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection';
const MET_SEARCH_TERMS = [
  'painting',
  'landscape',
  'portrait',
  'flowers',
  'seascape',
  'still life',
  'impressionism',
  'modern painting',
  'japanese painting',
  'american painting',
] as const;
const POOL_CACHE_KEY = 'nota:met-artwork-pool:v3';
const LAST_ARTWORK_KEY = 'nota:met-artwork-last:v1';
const POOL_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const POOL_SIZE = 48;
const SEARCH_PAGE_SIZE = 500;
const CANDIDATES_PER_TERM = 24;
const OBJECT_FETCH_BATCH_SIZE = 16;

let memoryPool: ArtworkPool | null = null;
let poolPromise: Promise<Artwork[]> | null = null;

export const isHttpsUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('https://');

export const isArtwork = (value: unknown): value is Artwork => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const artwork = value as Partial<Artwork>;
  return (
    isHttpsUrl(artwork.imageUrl) &&
    typeof artwork.title === 'string' &&
    typeof artwork.artist === 'string' &&
    typeof artwork.date === 'string'
  );
};

const artworkKey = (artwork: Artwork) =>
  String(artwork.objectId ?? artwork.imageUrl);

const readCachedPool = (): ArtworkPool | null => {
  try {
    const raw = localStorage.getItem(POOL_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const cached = JSON.parse(raw) as Partial<ArtworkPool>;
    if (
      typeof cached.fetchedAt !== 'number' ||
      !Array.isArray(cached.artworks)
    ) {
      return null;
    }
    const artworks = cached.artworks.filter(isArtwork);
    return artworks.length ? { artworks, fetchedAt: cached.fetchedAt } : null;
  } catch {
    return null;
  }
};

const writeCachedPool = (pool: ArtworkPool) => {
  try {
    localStorage.setItem(POOL_CACHE_KEY, JSON.stringify(pool));
  } catch {
    // The pool still works for this session without the cache.
  }
};

const pickCandidateIds = (objectIds: number[]) => {
  const count = Math.min(CANDIDATES_PER_TERM, objectIds.length);
  if (count === 0) {
    return [];
  }
  const stride = Math.floor(objectIds.length / count);
  const offset = Math.floor(Math.random() * stride);
  return Array.from(
    { length: count },
    (_, index) => objectIds[offset + index * stride]
  );
};

const shuffle = <T>(items: T[]) => {
  for (let index = items.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
};

const fetchSearchIds = async (term: string) => {
  const params = new URLSearchParams({
    hasImages: 'true',
    limit: String(SEARCH_PAGE_SIZE),
    medium: 'Paintings',
    q: term,
  });
  const response = await fetch(`${MET_API_BASE}/v1.1/search?${params}`);
  if (!response.ok) {
    throw new Error(`Met artwork search failed: ${response.status}`);
  }
  const search = (await response.json()) as MetSearchResponse;
  return Array.isArray(search.objectIDs) ? search.objectIDs : [];
};

const fetchObject = async (objectId: number) => {
  const response = await fetch(`${MET_API_BASE}/v1/objects/${objectId}`);
  if (!response.ok) {
    throw new Error(`Met artwork object failed: ${objectId}`);
  }
  return (await response.json()) as MetObjectResponse;
};

export const normalizeMetArtwork = (
  record: MetObjectResponse
): Artwork | null => {
  const imageUrl = record.primaryImageSmall || record.primaryImage;
  const artworkKind = [record.classification, record.medium, record.objectName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    !record.isPublicDomain ||
    !isHttpsUrl(imageUrl) ||
    !artworkKind.includes('paint')
  ) {
    return null;
  }

  return {
    artist:
      record.artistDisplayName?.trim() || 'The Metropolitan Museum of Art',
    date: record.objectDate?.trim() || 'date unknown',
    imageUrl,
    objectId: record.objectID,
    sourceUrl: isHttpsUrl(record.objectURL) ? record.objectURL : undefined,
    title: record.title?.trim() || 'Untitled artwork',
  };
};

const fetchArtworkPool = async () => {
  const searches = await Promise.allSettled(
    MET_SEARCH_TERMS.map(fetchSearchIds)
  );
  // Shuffled so the pool mixes every search term instead of filling up
  // from the first few.
  const candidateIds = shuffle([
    ...new Set(
      searches.flatMap(result =>
        result.status === 'fulfilled' ? pickCandidateIds(result.value) : []
      )
    ),
  ]);
  const artworkByImage = new Map<string, Artwork>();

  for (
    let index = 0;
    index < candidateIds.length && artworkByImage.size < POOL_SIZE;
    index += OBJECT_FETCH_BATCH_SIZE
  ) {
    const records = await Promise.allSettled(
      candidateIds
        .slice(index, index + OBJECT_FETCH_BATCH_SIZE)
        .map(fetchObject)
    );
    for (const record of records) {
      const artwork =
        record.status === 'fulfilled'
          ? normalizeMetArtwork(record.value)
          : null;
      if (artwork) {
        artworkByImage.set(artwork.imageUrl, artwork);
      }
    }
  }

  const artworks = [...artworkByImage.values()];
  if (artworks.length === 0) {
    throw new Error('Met artwork pool is empty');
  }
  return artworks;
};

/**
 * Public-domain paintings from the Met Collection API, refreshed daily.
 * An expired pool is still used when the API is unreachable.
 */
export const loadArtworkPool = (): Promise<Artwork[]> => {
  memoryPool ??= readCachedPool();
  if (memoryPool && Date.now() - memoryPool.fetchedAt < POOL_CACHE_TTL_MS) {
    return Promise.resolve(memoryPool.artworks);
  }

  const stale = memoryPool?.artworks;
  poolPromise ??= fetchArtworkPool()
    .then(artworks => {
      memoryPool = { artworks, fetchedAt: Date.now() };
      writeCachedPool(memoryPool);
      return artworks;
    })
    .catch(error => {
      if (stale?.length) {
        return stale;
      }
      throw error;
    })
    .finally(() => {
      poolPromise = null;
    });
  return poolPromise;
};

/**
 * Picks a random artwork, avoiding `current` and the previous pick on this
 * device so consecutive notes and meetings don't repeat.
 */
export const pickFreshArtwork = (pool: Artwork[], current?: Artwork | null) => {
  const artworks = pool.length ? pool : [DEFAULT_ARTWORK];
  let lastKey: string | null = null;
  try {
    lastKey = localStorage.getItem(LAST_ARTWORK_KEY);
  } catch {
    // Rotation works without remembering the previous pick.
  }
  const excluded = new Set([lastKey, current ? artworkKey(current) : null]);
  const candidates = artworks.filter(
    artwork => !excluded.has(artworkKey(artwork))
  );
  const choices = candidates.length ? candidates : artworks;
  const next = choices[Math.floor(Math.random() * choices.length)];
  try {
    localStorage.setItem(LAST_ARTWORK_KEY, artworkKey(next));
  } catch {
    // Rotation works without remembering the previous pick.
  }
  return next;
};
