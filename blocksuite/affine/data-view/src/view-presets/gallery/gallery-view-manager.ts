import { computed } from '@preact/signals-core';

import { CardSingleView } from '../card-view-manager.js';
import type {
  GalleryCardSize,
  GalleryCoverFit,
  GalleryViewData,
} from './define.js';

const GALLERY_CARD_SIZES = new Set<GalleryCardSize>([
  'small',
  'medium',
  'large',
]);
const GALLERY_COVER_FITS = new Set<GalleryCoverFit>(['cover', 'contain']);

export class GallerySingleView extends CardSingleView<GalleryViewData> {
  get type() {
    return 'gallery';
  }

  imageProperties$ = computed(() =>
    this.propertiesRaw$.value.filter(property =>
      ['image', 'attachment'].includes(property.type$.value ?? '')
    )
  );

  imageProperty$ = computed(() => {
    const id = this.data$.value?.header.imageColumn;
    return this.imageProperties$.value.find(property => property.id === id);
  });

  cardSize$ = computed<GalleryCardSize>(() => {
    const size = this.data$.value?.cardSize;
    return size && GALLERY_CARD_SIZES.has(size) ? size : 'medium';
  });

  coverFit$ = computed<GalleryCoverFit>(() => {
    const fit = this.data$.value?.coverFit;
    return fit && GALLERY_COVER_FITS.has(fit) ? fit : 'cover';
  });

  imageColumnSet(id: string | undefined): void {
    if (
      this.readonly$.value ||
      (id && !this.imageProperties$.value.some(p => p.id === id))
    )
      return;
    this.dataUpdate(data => ({ header: { ...data.header, imageColumn: id } }));
  }

  cardSizeSet(size: GalleryCardSize): void {
    if (this.readonly$.value || !GALLERY_CARD_SIZES.has(size)) return;
    this.dataUpdate(() => ({ cardSize: size }));
  }

  coverFitSet(fit: GalleryCoverFit): void {
    if (this.readonly$.value || !GALLERY_COVER_FITS.has(fit)) return;
    this.dataUpdate(() => ({ coverFit: fit }));
  }
}
