import type { DocTitle } from '@blocksuite/affine/fragments/doc-title';
import type { Store } from '@blocksuite/affine/store';
import { notify, Popover } from '@nota/component';
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
import {
  clampCoverPositionY,
  COVER_PRESETS,
  isPageCoverCustom,
  isValidCoverUrl,
  type PageCoverPreset,
  validateCoverImageFile,
} from '@nota/core/utils/page-cover';
import { useLiveData, useService } from '@nota/infra';
import clsx from 'clsx';
import dayjs from 'dayjs';
import {
  type ChangeEvent,
  type FormEvent,
  forwardRef,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  RiDragMove2Line,
  RiExternalLinkLine,
  RiEyeOffLine,
  RiImageAddLine,
  RiImageEditLine,
  RiShuffleLine,
  RiUpload2Line,
} from 'react-icons/ri';

import * as styles from './brief-cover-title.css';
import { DocIconPicker } from './doc-icon-picker';

type CoverPickerTab = 'gallery' | 'upload' | 'link';

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
  const savedCustom = isPageCoverCustom(properties?.coverCustom)
    ? properties.coverCustom
    : null;
  const savedPositionY = clampCoverPositionY(properties?.coverPositionY);
  const hidden = !!properties?.coverHidden;
  const editable = !readonly && !!record;

  const isCustomCover = !!savedCustom && savedCustom.kind !== 'artwork';
  const [unsavedArtwork, setUnsavedArtwork] = useState<Artwork | null>(null);
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);
  const [blobCoverUrl, setBlobCoverUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<CoverPickerTab>('gallery');
  const [linkInput, setLinkInput] = useState('');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [draftPositionY, setDraftPositionY] = useState(savedPositionY);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragStartRef = useRef<{ y: number; positionY: number } | null>(null);

  const needsArtwork = !savedArtwork && !hidden && !isCustomCover;

  useEffect(() => {
    setDraftPositionY(savedPositionY);
  }, [savedPositionY]);

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

  const blobId = savedCustom?.kind === 'blob' ? savedCustom.blobId : null;
  useEffect(() => {
    if (!blobId || hidden) {
      setBlobCoverUrl(null);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    page.blobSync
      .get(blobId)
      .then(blob => {
        if (disposed || !blob) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setBlobCoverUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) {
          setBlobCoverUrl(null);
        }
      });
    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [blobId, hidden, page.blobSync]);

  const artwork = savedArtwork ?? unsavedArtwork;
  const shownArtwork =
    artwork && artwork.imageUrl === brokenImageUrl ? DEFAULT_ARTWORK : artwork;
  const activePositionY = repositioning ? draftPositionY : savedPositionY;

  const isImageCover =
    !isCustomCover || savedCustom.kind === 'blob' || savedCustom.kind === 'url';

  const shuffleArtwork = useCallback(() => {
    loadArtworkPool()
      .then(pool => {
        record?.updateProperties({
          coverArtwork: pickFreshArtwork(pool, artwork),
          coverCustom: { kind: 'artwork' },
          coverHidden: false,
        });
        setBrokenImageUrl(null);
        setPickerOpen(false);
      })
      .catch(() => {
        notify.error({
          title: 'Couldn’t load new artwork',
          message: 'Check your internet connection and try again.',
        });
      });
  }, [artwork, record]);

  const selectGradientPreset = useCallback(
    (preset: PageCoverPreset) => {
      record?.updateProperties({
        coverCustom: {
          kind: 'gradient',
          value: preset.value,
          label: preset.label,
        },
        coverHidden: false,
      });
      setRepositioning(false);
      setPickerError(null);
      setPickerOpen(false);
    },
    [record]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !record) {
        return;
      }
      const validation = validateCoverImageFile(file);
      if (!validation.ok) {
        setPickerError(validation.error);
        return;
      }
      setUploading(true);
      setPickerError(null);
      try {
        const nextBlobId = await page.blobSync.set(file);
        record.updateProperties({
          coverCustom: { kind: 'blob', blobId: nextBlobId },
          coverPositionY: 50,
          coverHidden: false,
        });
        setPickerOpen(false);
      } catch {
        setPickerError('Could not save cover image to local storage.');
      } finally {
        setUploading(false);
      }
    },
    [page.blobSync, record]
  );

  const handleLinkSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = linkInput.trim();
      if (!isValidCoverUrl(trimmed)) {
        setPickerError('Enter a valid https:// image URL.');
        return;
      }
      record?.updateProperties({
        coverCustom: { kind: 'url', url: trimmed },
        coverPositionY: 50,
        coverHidden: false,
      });
      setBrokenImageUrl(null);
      setPickerError(null);
      setLinkInput('');
      setPickerOpen(false);
    },
    [linkInput, record]
  );

  const hideCover = useCallback(() => {
    setRepositioning(false);
    setPickerOpen(false);
    record?.setProperty('coverHidden', true);
  }, [record]);

  const showCover = useCallback(() => {
    record?.setProperty('coverHidden', false);
  }, [record]);

  const startReposition = useCallback(() => {
    setDraftPositionY(savedPositionY);
    setPickerOpen(false);
    setRepositioning(true);
  }, [savedPositionY]);

  const saveReposition = useCallback(() => {
    record?.setProperty('coverPositionY', clampCoverPositionY(draftPositionY));
    setRepositioning(false);
  }, [draftPositionY, record]);

  const cancelReposition = useCallback(() => {
    setDraftPositionY(savedPositionY);
    setRepositioning(false);
  }, [savedPositionY]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!repositioning) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartRef.current = { y: event.clientY, positionY: draftPositionY };
    },
    [draftPositionY, repositioning]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!repositioning || !start) return;
      const deltaY = event.clientY - start.y;
      setDraftPositionY(clampCoverPositionY(start.positionY - deltaY * 0.35));
    },
    [repositioning]
  );

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const pickerContent = (
    <div className={styles.coverPicker} data-testid="page-cover-picker">
      <div
        className={styles.coverTabs}
        role="tablist"
        aria-label="Cover source"
      >
        {(
          [
            { id: 'gallery', label: 'Gallery' },
            { id: 'upload', label: 'Upload' },
            { id: 'link', label: 'Link' },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={pickerTab === tab.id}
            className={styles.coverTab}
            data-active={pickerTab === tab.id}
            data-testid={`page-cover-tab-${tab.id}`}
            onClick={() => {
              setPickerTab(tab.id);
              setPickerError(null);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {pickerTab === 'gallery' ? (
        <>
          <div className={styles.presetGrid}>
            {COVER_PRESETS.map(preset => {
              const active =
                savedCustom?.kind === 'gradient' &&
                savedCustom.value === preset.value;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-label={preset.label}
                  title={preset.label}
                  className={styles.presetSwatch}
                  data-active={active}
                  data-testid={`page-cover-preset-${preset.id}`}
                  style={{ background: preset.value }}
                  onClick={() => selectGradientPreset(preset)}
                />
              );
            })}
          </div>
          <button
            type="button"
            className={styles.pickerSecondaryButton}
            data-testid="page-cover-met-artwork"
            onClick={shuffleArtwork}
          >
            <RiShuffleLine aria-hidden />
            Use Met Museum artwork
          </button>
        </>
      ) : null}

      {pickerTab === 'upload' ? (
        <div className={styles.pickerForm}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            style={{ display: 'none' }}
            data-testid="page-cover-file-input"
            onChange={event => {
              handleFileChange(event).catch(() => {});
            }}
          />
          <button
            type="button"
            className={styles.pickerSecondaryButton}
            disabled={uploading}
            data-testid="page-cover-upload-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <RiUpload2Line aria-hidden />
            {uploading ? 'Uploading…' : 'Upload image from device'}
          </button>
          <p className={styles.pickerHint}>
            Stored locally in your workspace (PNG, JPG, WebP, GIF, AVIF up to 10
            MB).
          </p>
        </div>
      ) : null}

      {pickerTab === 'link' ? (
        <form className={styles.pickerForm} onSubmit={handleLinkSubmit}>
          <input
            type="url"
            className={styles.pickerInput}
            placeholder="https://example.com/cover.jpg"
            value={linkInput}
            data-testid="page-cover-url-input"
            onChange={event => {
              setLinkInput(event.target.value);
              setPickerError(null);
            }}
          />
          <button
            type="submit"
            className={styles.pickerSecondaryButton}
            data-testid="page-cover-url-submit"
          >
            Apply image URL
          </button>
        </form>
      ) : null}

      {pickerError ? (
        <p className={styles.pickerError} role="alert">
          {pickerError}
        </p>
      ) : null}
    </div>
  );

  return (
    <section
      className={styles.briefCover}
      aria-label="Note cover"
      data-cover-hidden={hidden}
    >
      {!hidden ? (
        <div className={styles.hero}>
          <div
            className={clsx(
              styles.heroArt,
              repositioning && styles.heroRepositioning
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {savedCustom?.kind === 'gradient' ? (
              <div
                aria-label={savedCustom.label}
                className={styles.heroGradient}
                data-testid="page-cover-gradient"
                style={{ background: savedCustom.value }}
              />
            ) : savedCustom?.kind === 'blob' && blobCoverUrl ? (
              <img
                alt="Page cover"
                className={styles.heroImage}
                data-testid="page-cover-blob-image"
                decoding="async"
                draggable={false}
                src={blobCoverUrl}
                style={{ objectPosition: `center ${activePositionY}%` }}
              />
            ) : savedCustom?.kind === 'url' &&
              savedCustom.url !== brokenImageUrl ? (
              <img
                alt="Page cover"
                className={styles.heroImage}
                data-testid="page-cover-url-image"
                decoding="async"
                draggable={false}
                onError={() => setBrokenImageUrl(savedCustom.url)}
                referrerPolicy="no-referrer"
                src={savedCustom.url}
                style={{ objectPosition: `center ${activePositionY}%` }}
              />
            ) : !isCustomCover && shownArtwork ? (
              <img
                alt={`${shownArtwork.title}, ${shownArtwork.artist}, ${shownArtwork.date}`}
                className={styles.heroImage}
                decoding="async"
                draggable={false}
                onError={() => setBrokenImageUrl(shownArtwork.imageUrl)}
                referrerPolicy="no-referrer"
                src={shownArtwork.imageUrl}
                style={{ objectPosition: `center ${activePositionY}%` }}
              />
            ) : null}
          </div>
          {editable ? (
            <div className={styles.heroActions}>
              <Popover
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                content={pickerContent}
                contentOptions={{ align: 'end' }}
              >
                <button
                  aria-label="Change cover"
                  className={styles.heroActionLabel}
                  data-testid="page-cover-change-button"
                  title="Change cover"
                  type="button"
                >
                  <RiImageEditLine aria-hidden size={14} />
                  Change cover
                </button>
              </Popover>
              {isImageCover ? (
                <button
                  aria-label="Reposition cover"
                  className={styles.heroAction}
                  data-testid="page-cover-reposition-button"
                  onClick={repositioning ? saveReposition : startReposition}
                  title="Reposition cover"
                  type="button"
                >
                  <RiDragMove2Line aria-hidden />
                </button>
              ) : null}
              {!isCustomCover ? (
                <button
                  aria-label="Shuffle artwork"
                  className={styles.heroAction}
                  onClick={shuffleArtwork}
                  title="Shuffle artwork"
                  type="button"
                >
                  <RiShuffleLine aria-hidden />
                </button>
              ) : null}
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
          {repositioning ? (
            <div
              className={styles.repositionBar}
              data-testid="page-cover-reposition-bar"
            >
              <span>Drag cover or adjust</span>
              <input
                aria-label="Cover vertical position"
                className={styles.repositionSlider}
                max={100}
                min={0}
                onChange={event =>
                  setDraftPositionY(
                    clampCoverPositionY(Number(event.target.value))
                  )
                }
                type="range"
                value={draftPositionY}
              />
              <button
                className={styles.repositionButton}
                data-testid="page-cover-reposition-save"
                onClick={saveReposition}
                type="button"
              >
                Save
              </button>
              <button
                className={styles.repositionButton}
                onClick={cancelReposition}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : null}
          {!repositioning && !isCustomCover && shownArtwork ? (
            <div className={styles.credit}>
              <div className={styles.creditTitle}>{shownArtwork.title}</div>
              <div>
                {shownArtwork.artist}, {shownArtwork.date}
              </div>
              {isHttpsUrl(shownArtwork.sourceUrl) ? (
                <a
                  className={styles.creditSource}
                  href={shownArtwork.sourceUrl}
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
