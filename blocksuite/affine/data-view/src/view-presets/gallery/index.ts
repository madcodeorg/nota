import { createIcon } from '../../core/utils/uni-icon.js';
import { galleryViewModel } from './define.js';
import { GalleryViewUILogic } from './renderer.js';

export * from './define.js';
export * from './gallery-view-manager.js';
export * from './renderer.js';

export const galleryViewMeta = galleryViewModel.createMeta({
  icon: createIcon('GridIcon'),
  // @ts-expect-error Existing view renderer constructors specialize SingleView.
  pcLogic: () => GalleryViewUILogic,
  // @ts-expect-error Existing view renderer constructors specialize SingleView.
  mobileLogic: () => GalleryViewUILogic,
});
