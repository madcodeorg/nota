import { viewType } from '../../core/view/data-view.js';
import type { CardViewData } from '../card-view-manager.js';
import { GallerySingleView } from './gallery-view-manager.js';

export type GalleryViewData = CardViewData & { mode: 'gallery' };
export const galleryViewType = viewType('gallery');
export const galleryViewModel = galleryViewType.createModel<GalleryViewData>({
  defaultName: 'Gallery View',
  dataViewManager: GallerySingleView,
  defaultData: manager => ({
    columns: [],
    filter: { type: 'group', op: 'and', conditions: [] },
    header: {
      imageColumn: manager.dataSource.properties$.value.find(
        id => manager.dataSource.propertyTypeGet(id) === 'image'
      ),
    },
  }),
});
