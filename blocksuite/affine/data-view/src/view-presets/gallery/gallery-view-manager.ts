import { computed } from '@preact/signals-core';

import { CardSingleView } from '../card-view-manager.js';
import type { GalleryViewData } from './define.js';

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

  imageColumnSet(id: string | undefined): void {
    if (
      this.readonly$.value ||
      (id && !this.imageProperties$.value.some(p => p.id === id))
    )
      return;
    this.dataUpdate(data => ({ header: { ...data.header, imageColumn: id } }));
  }
}
