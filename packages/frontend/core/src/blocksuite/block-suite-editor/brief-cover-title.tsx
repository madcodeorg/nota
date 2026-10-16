import type { DocTitle } from '@blocksuite/affine/fragments/doc-title';
import type { Store } from '@blocksuite/affine/store';
import { notify } from '@nota/component';
import { LitDocTitle } from '@nota/core/blocksuite/editors';
import { DocsService } from '@nota/core/modules/doc';
import {
  type Artwork,
  DEFAULT_ARTWORK,
  isArtwork,
  isHttpsUrl,
  loadArtworkPool,
  pickFreshArtwork,
} from '@nota/core/utils/met-artwork';
import { useLiveData, useService } from '@nota/infra';
import dayjs from 'dayjs';
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import {
  RiExternalLinkLine,
  RiEyeOffLine,
  RiImageAddLine,
  RiShuffleLine,
} from 'react-icons/ri';

import * as styles from './brief-cover-title.css';
import { DocIconPicker } from './doc-icon-picker';

const getDocCreatedDate = (page: Store, fallbackCreatedAt: number) => {
  const createDate = page.meta?.createDate;
  return typeof createDate === 'number' ? createDate : fallbackCreatedAt;
};

export const BriefCoverTitle = forwardRef<
  DocTitle,
  {
    page: Store;
    readonly?: boolean;
  }
>(function BriefCoverTitle({ page, readonly }, titleRef) {
  const [fallbackCreatedAt] = useState(() => Date.now());
  const created = dayjs(getDocCreatedDate(page, fallbackCreatedAt));
  const docsService = useService(DocsService);
  const record = useLiveData(
    useMemo(() => docsService.list.doc$(page.id), [docsService, page.id])
  );
  const properties = useLiveData(record?.properties$);
  const savedArtwork = isArtwork(properties?.coverArtwork)
    ? properties.coverArtwork
    : null;
  const hidden = !!properties?.coverHidden;
  const editable = !readonly && !!record;
  const [unsavedArtwork, setUnsavedArtwork] = useState<Artwork | null>(null);
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const needsArtwork = !savedArtwork && !hidden;

  useEffect(() => {
    if (!needsArtwork) {
      return;
    }
    let disposed = false;
    loadArtworkPool()
      .then(pool => {
        if (disposed) {
          return;
        }
        const next = pickFreshArtwork(pool);
        if (!readonly && record) {
          record.setProperty('coverArtwork', next);
        } else {
          setUnsavedArtwork(next);
        }
      })
      .catch(() => {
        // Not saved, so the note picks up live art once the API is reachable.
        if (!disposed) {
          setUnsavedArtwork(DEFAULT_ARTWORK);
        }
      });
    return () => {
      disposed = true;
    };
  }, [needsArtwork, readonly, record]);

  const artwork = savedArtwork ?? unsavedArtwork;
  const shown =
    artwork && artwork.imageUrl === brokenImageUrl ? DEFAULT_ARTWORK : artwork;

  const shuffleArtwork = useCallback(() => {
    loadArtworkPool()
      .then(pool => {
        record?.setProperty('coverArtwork', pickFreshArtwork(pool, artwork));
      })
      .catch(() => {
        notify.error({
          title: 'Couldn’t load new artwork',
          message: 'Check your internet connection and try again.',
        });
      });
  }, [artwork, record]);

  const hideCover = useCallback(() => {
    record?.setProperty('coverHidden', true);
  }, [record]);

  const showCover = useCallback(() => {
    record?.setProperty('coverHidden', false);
  }, [record]);

  return (
    <section
      className={styles.briefCover}
      aria-label="Note cover"
      data-cover-hidden={hidden}
    >
      {!hidden ? (
        <div className={styles.hero}>
          <div className={styles.heroArt}>
            {shown ? (
              <img
                alt={`${shown.title}, ${shown.artist}, ${shown.date}`}
                className={styles.heroImage}
                decoding="async"
                onError={() => setBrokenImageUrl(shown.imageUrl)}
                referrerPolicy="no-referrer"
                src={shown.imageUrl}
              />
            ) : null}
          </div>
          {editable ? (
            <div className={styles.heroActions}>
              <button
                aria-label="Shuffle artwork"
                className={styles.heroAction}
                onClick={shuffleArtwork}
                title="Shuffle artwork"
                type="button"
              >
                <RiShuffleLine aria-hidden />
              </button>
              <button
                aria-label="Hide cover"
                className={styles.heroAction}
                onClick={hideCover}
                title="Hide cover"
                type="button"
              >
                <RiEyeOffLine aria-hidden />
              </button>
            </div>
          ) : null}
          {shown ? (
            <div className={styles.credit}>
              <div className={styles.creditTitle}>{shown.title}</div>
              <div>
                {shown.artist}, {shown.date}
              </div>
              {isHttpsUrl(shown.sourceUrl) ? (
                <a
                  className={styles.creditSource}
                  href={shown.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  The Metropolitan Museum of Art · Public domain
                  <RiExternalLinkLine aria-hidden />
                </a>
              ) : (
                <span className={styles.creditSource}>
                  The Metropolitan Museum of Art · Public domain
                </span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.titleArea}>
        <div className={styles.headerTools}>
          {!BUILD_CONFIG.isMobileEdition ? (
            <DocIconPicker docId={page.id} readonly={readonly} />
          ) : null}
          {hidden && editable ? (
            <button className={styles.chip} onClick={showCover} type="button">
              <RiImageAddLine aria-hidden />
              Add cover
            </button>
          ) : null}
        </div>
        <LitDocTitle doc={page} ref={titleRef} />
        <div className={styles.dateLine}>
          {created.format('dddd D MMMM YYYY · h:mm A')}
        </div>
      </div>
    </section>
  );
});
