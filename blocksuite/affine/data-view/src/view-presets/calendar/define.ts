import { viewType } from '../../core/view/data-view.js';
import type { CardViewData } from '../card-view-manager.js';
import { CalendarSingleView } from './calendar-view-manager.js';

export type CalendarViewData = CardViewData & {
  mode: 'calendar';
  dateColumn?: string;
  month?: string;
};

export const calendarViewType = viewType('calendar');
export const calendarViewModel = calendarViewType.createModel<CalendarViewData>(
  {
    defaultName: 'Calendar View',
    dataViewManager: CalendarSingleView,
    defaultData: manager => ({
      columns: [],
      filter: { type: 'group', op: 'and', conditions: [] },
      header: {},
      dateColumn: manager.dataSource.properties$.value.find(
        id => manager.dataSource.propertyTypeGet(id) === 'date'
      ),
    }),
  }
);
