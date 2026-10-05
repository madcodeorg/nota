import { createIcon } from '../../core/utils/uni-icon.js';
import { calendarViewModel } from './define.js';
import { CalendarViewUILogic } from './renderer.js';

export * from './calendar-view-manager.js';
export * from './date-utils.js';
export * from './define.js';
export * from './renderer.js';

export const calendarViewMeta = calendarViewModel.createMeta({
  icon: createIcon('CalendarPanelIcon'),
  // @ts-expect-error Existing view renderer constructors specialize SingleView.
  pcLogic: () => CalendarViewUILogic,
  // @ts-expect-error Existing view renderer constructors specialize SingleView.
  mobileLogic: () => CalendarViewUILogic,
});
