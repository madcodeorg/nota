import { calendarEffects } from './calendar/renderer.js';
import { galleryEffects } from './gallery/renderer.js';
import { kanbanEffects } from './kanban/effect.js';
import { tableEffects } from './table/effect.js';

export function viewPresetsEffects() {
  calendarEffects();
  galleryEffects();
  kanbanEffects();
  tableEffects();
}
