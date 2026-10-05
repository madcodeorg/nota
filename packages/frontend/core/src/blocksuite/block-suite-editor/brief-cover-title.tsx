import type { DocTitle } from '@blocksuite/affine/fragments/doc-title';
import type { Store } from '@blocksuite/affine/store';
import { LitDocTitle } from '@nota/core/blocksuite/editors';
import dayjs from 'dayjs';
import { forwardRef, useEffect, useState } from 'react';

import * as styles from './brief-cover-title.css';
import { DocIconPicker } from './doc-icon-picker';

type Artwork = {
  artist: string;
  date: string;
  imageUrl: string;
  objectId?: number;
  sourceUrl?: string;
  title: string;
};

const DEFAULT_ARTWORK: Artwork = {
  imageUrl:
    'https://images.metmuseum.org/CRDImages/ep/web-large/DP-42549-001.jpg',
  title: 'Wheat Field with Cypresses',
  artist: 'Vincent van Gogh',
  date: '1889',
};

type CachedArtworkPool = {
  artworks: Artwork[];
  fetchedAt: number;
};

type PageArtworkAssignment = {
  assignedAt: number;
  imageUrl: string;
  objectId?: number;
};

type PageArtworkAssignments = {
  assignments: Record<string, PageArtworkAssignment>;
};

type MetSearchResponse = {
  objectIDs?: number[] | null;
  total: number;
};

type MetObjectResponse = {
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

const FALLBACK_ARTWORKS: Artwork[] = [DEFAULT_ARTWORK];

const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
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
const MET_ARTWORK_CACHE_KEY = 'nota:brief-cover-met-artworks:v2';
const PAGE_ARTWORK_CACHE_KEY = 'nota:brief-cover-page-artworks:v1';
const LAST_ARTWORK_CACHE_KEY = 'nota:brief-cover-last-artwork:v1';
const MET_ARTWORK_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MET_ARTWORK_POOL_SIZE = 96;
const MET_CANDIDATE_SCAN_SIZE = 64;
const MET_FETCH_BATCH_SIZE = 8;
const MAX_PAGE_ARTWORK_ASSIGNMENTS = 512;

let artworkPoolPromise: Promise<Artwork[]> | null = null;
let memoryArtworkPool: Artwork[] | null = null;

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getDocCreatedDate = (page: Store, fallbackCreatedAt: number) => {
  const createDate = page.meta?.createDate;
  return typeof createDate === 'number' ? createDate : fallbackCreatedAt;
};

const isArtworkPool = (value: unknown): value is Artwork[] => {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Artwork).imageUrl === 'string' &&
        typeof (item as Artwork).title === 'string' &&
        typeof (item as Artwork).artist === 'string' &&
        typeof (item as Artwork).date === 'string'
    )
  );
};

const getArtworkMatch = (
  assignment: PageArtworkAssignment,
  artworkPool: Artwork[]
) => {
  return artworkPool.find(artwork => {
    if (assignment.objectId && artwork.objectId) {
      return assignment.objectId === artwork.objectId;
    }

    return assignment.imageUrl === artwork.imageUrl;
  });
};

const readCachedArtworkPool = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(MET_ARTWORK_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as Partial<CachedArtworkPool>;
    if (
      typeof cached.fetchedAt !== 'number' ||
      Date.now() - cached.fetchedAt > MET_ARTWORK_CACHE_TTL_MS ||
      !isArtworkPool(cached.artworks) ||
      cached.artworks.length === 0
    ) {
      return null;
    }

    return cached.artworks;
  } catch {
    return null;
  }
};

const writeCachedArtworkPool = (artworks: Artwork[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      MET_ARTWORK_CACHE_KEY,
      JSON.stringify({ artworks, fetchedAt: Date.now() })
    );
  } catch {
    // Caching is a performance feature; the cover still works without it.
  }
};

const readPageArtworkAssignments = (): PageArtworkAssignments => {
  if (typeof window === 'undefined') {
    return { assignments: {} };
  }

  try {
    const raw = window.localStorage.getItem(PAGE_ARTWORK_CACHE_KEY);
    if (!raw) {
      return { assignments: {} };
    }

    const cached = JSON.parse(raw) as Partial<PageArtworkAssignments>;
    if (!cached.assignments || typeof cached.assignments !== 'object') {
      return { assignments: {} };
    }

    return {
      assignments: Object.fromEntries(
        Object.entries(cached.assignments).filter(
          (entry): entry is [string, PageArtworkAssignment] => {
            const assignment = entry[1];
            return (
              typeof assignment === 'object' &&
              assignment !== null &&
              typeof assignment.assignedAt === 'number' &&
              typeof assignment.imageUrl === 'string'
            );
          }
        )
      ),
    };
  } catch {
    return { assignments: {} };
  }
};

const writePageArtworkAssignments = (
  assignments: PageArtworkAssignments['assignments']
) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const prunedAssignments = Object.fromEntries(
      Object.entries(assignments)
        .sort(([, left], [, right]) => right.assignedAt - left.assignedAt)
        .slice(0, MAX_PAGE_ARTWORK_ASSIGNMENTS)
    );

    window.localStorage.setItem(
      PAGE_ARTWORK_CACHE_KEY,
      JSON.stringify({ assignments: prunedAssignments })
    );
  } catch {
    // The page still receives artwork without a persistent assignment cache.
  }
};

const pickCandidateIds = (objectIds: number[]) => {
  const candidateCount = Math.min(MET_CANDIDATE_SCAN_SIZE, objectIds.length);
  if (candidateCount === 0) {
    return [];
  }

  const stride = Math.max(1, Math.floor(objectIds.length / candidateCount));
  const cacheBucket = Math.floor(Date.now() / MET_ARTWORK_CACHE_TTL_MS);
  const offset = hashString(`met-artwork-${cacheBucket}`) % stride;
  const ids: number[] = [];

  for (let index = 0; index < candidateCount; index++) {
    ids.push(objectIds[(offset + index * stride) % objectIds.length]);
  }

  return ids;
};

const buildMetSearchUrl = (term: string) => {
  const params = new URLSearchParams({
    hasImages: 'true',
    medium: 'Paintings',
    q: term,
  });

  return `${MET_API_BASE}/search?${params.toString()}`;
};

const fetchMetSearchIds = async (term: string) => {
  const search = (await fetch(buildMetSearchUrl(term)).then(response => {
    if (!response.ok) {
      throw new Error(`Met artwork search failed: ${term}`);
    }
    return response.json();
  })) as MetSearchResponse;

  return Array.isArray(search.objectIDs) ? search.objectIDs : [];
};

const normalizeMetArtwork = (record: MetObjectResponse): Artwork | null => {
  const imageUrl = record.primaryImageSmall || record.primaryImage;
  const artworkKind = [record.classification, record.medium, record.objectName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!record.isPublicDomain || !imageUrl || !artworkKind.includes('paint')) {
    return null;
  }

  return {
    artist:
      record.artistDisplayName?.trim() || 'The Metropolitan Museum of Art',
    date: record.objectDate?.trim() || 'date unknown',
    imageUrl,
    objectId: record.objectID,
    sourceUrl: record.objectURL,
    title: record.title?.trim() || 'Untitled artwork',
  };
};

const fetchMetArtworkPool = async () => {
  const searchResults = await Promise.allSettled(
    MET_SEARCH_TERMS.map(fetchMetSearchIds)
  );
  const candidateIds = [
    ...new Set(
      searchResults.flatMap(result =>
        result.status === 'fulfilled' ? pickCandidateIds(result.value) : []
      )
    ),
  ];
  const artworkByImage = new Map<string, Artwork>();

  for (
    let index = 0;
    index < candidateIds.length && artworkByImage.size < MET_ARTWORK_POOL_SIZE;
    index += MET_FETCH_BATCH_SIZE
  ) {
    const batchIds = candidateIds.slice(index, index + MET_FETCH_BATCH_SIZE);
    const records = await Promise.allSettled(
      batchIds.map(async objectId => {
        const response = await fetch(`${MET_API_BASE}/objects/${objectId}`);
        if (!response.ok) {
          throw new Error(`Met artwork object failed: ${objectId}`);
        }
        return (await response.json()) as MetObjectResponse;
      })
    );

    for (const record of records) {
      if (record.status !== 'fulfilled') {
        continue;
      }

      const artwork = normalizeMetArtwork(record.value);
      if (artwork) {
        artworkByImage.set(artwork.imageUrl, artwork);
      }
    }
  }

  const artworks = [...artworkByImage.values()];
  if (artworks.length === 0) {
    throw new Error('Met artwork pool is empty');
  }

  writeCachedArtworkPool(artworks);
  memoryArtworkPool = artworks;

  return artworks;
};

const loadMetArtworkPool = () => {
  if (memoryArtworkPool) {
    return Promise.resolve(memoryArtworkPool);
  }

  const cached = readCachedArtworkPool();
  if (cached) {
    memoryArtworkPool = cached;
    return Promise.resolve(cached);
  }

  artworkPoolPromise ??= fetchMetArtworkPool().catch(error => {
    artworkPoolPromise = null;
    throw error;
  });

  return artworkPoolPromise;
};

const artworkStorageKey = (artwork: Artwork) => {
  return String(artwork.objectId ?? artwork.imageUrl);
};

const pickFreshArtwork = (artworks: Artwork[]) => {
  const pool = artworks.length ? artworks : [DEFAULT_ARTWORK];
  const lastArtworkKey = (() => {
    try {
      return window.localStorage.getItem(LAST_ARTWORK_CACHE_KEY);
    } catch {
      return null;
    }
  })();
  const candidates =
    pool.length > 1
      ? pool.filter(artwork => artworkStorageKey(artwork) !== lastArtworkKey)
      : pool;
  const next =
    candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];

  try {
    window.localStorage.setItem(
      LAST_ARTWORK_CACHE_KEY,
      artworkStorageKey(next)
    );
  } catch {
    // Artwork rotation can work without remembering the previous image.
  }

  return next;
};

const assignArtworkForPage = (pageId: string, artworkPool: Artwork[]) => {
  const pool = artworkPool.length ? artworkPool : [DEFAULT_ARTWORK];
  const pageAssignments = readPageArtworkAssignments();
  const existingAssignment = pageAssignments.assignments[pageId];
  if (existingAssignment) {
    const assignedArtwork = getArtworkMatch(existingAssignment, pool);
    if (assignedArtwork) {
      return assignedArtwork;
    }
  }

  const selectedArtwork = pickFreshArtwork(pool);
  pageAssignments.assignments[pageId] = {
    assignedAt: Date.now(),
    imageUrl: selectedArtwork.imageUrl,
    objectId: selectedArtwork.objectId,
  };
  writePageArtworkAssignments(pageAssignments.assignments);

  return selectedArtwork;
};

export const BriefCoverTitle = forwardRef<
  DocTitle,
  {
    page: Store;
    readonly?: boolean;
  }
>(function BriefCoverTitle({ page, readonly }, titleRef) {
  const [fallbackCreatedAt] = useState(() => Date.now());
  const createdAt = getDocCreatedDate(page, fallbackCreatedAt);
  const created = dayjs(createdAt);
  const [artwork, setArtwork] = useState(DEFAULT_ARTWORK);

  useEffect(() => {
    let disposed = false;

    loadMetArtworkPool()
      .then(artworks => {
        if (!disposed) {
          setArtwork(assignArtworkForPage(page.id, artworks));
        }
      })
      .catch(() => {
        if (!disposed) {
          setArtwork(assignArtworkForPage(page.id, FALLBACK_ARTWORKS));
        }
      });

    return () => {
      disposed = true;
    };
  }, [page.id]);

  return (
    <section className={styles.briefCover} aria-label="Note cover">
      <div
        className={styles.sideDate}
        aria-label={created.format('DD MMM YYYY')}
      >
        {created.format('DD MMM YYYY').toUpperCase()}
      </div>
      <div className={styles.coverColumn}>
        <div className={styles.coverFrame}>
          <img
            alt={`${artwork.title}, ${artwork.artist}, ${artwork.date}`}
            className={styles.coverImage}
            decoding="async"
            referrerPolicy="no-referrer"
            src={artwork.imageUrl}
          />
          <div className={styles.titleStack}>
            {!BUILD_CONFIG.isMobileEdition ? (
              <div className={styles.coverIcon}>
                <DocIconPicker docId={page.id} readonly={readonly} />
              </div>
            ) : null}
            <LitDocTitle doc={page} ref={titleRef} />
          </div>
        </div>
      </div>
      <div className={styles.sideTime} aria-label={created.format('hh:mm A')}>
        {created.format('hh:mm A')}
      </div>
    </section>
  );
});
