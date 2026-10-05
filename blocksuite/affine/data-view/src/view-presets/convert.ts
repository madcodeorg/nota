import type { FilterGroup } from '../core/filter/types.js';
import type { Sort } from '../core/sort/types.js';
import { createViewConvert } from '../core/view/convert.js';
import { calendarViewModel } from './calendar/define.js';
import { galleryViewModel } from './gallery/define.js';
import { kanbanViewModel } from './kanban/index.js';
import { DEFAULT_COLUMN_WIDTH } from './table/consts.js';
import { tableViewModel } from './table/index.js';

const keepCardOptions = (data: {
  filter: FilterGroup;
  sort?: Sort;
  columns: { id: string; hide?: boolean; width?: number }[];
  header?: { titleColumn?: string; imageColumn?: string; coverColumn?: string };
}) => ({
  filter: data.filter,
  sort: data.sort,
  columns: data.columns.map(column => ({
    id: column.id,
    hide: column.hide,
    width: column.width ?? DEFAULT_COLUMN_WIDTH,
  })),
  header: {
    titleColumn: data.header?.titleColumn,
    imageColumn: data.header?.imageColumn ?? data.header?.coverColumn,
    coverColumn: data.header?.coverColumn ?? data.header?.imageColumn,
  },
});

export const viewConverts = [
  createViewConvert(tableViewModel, calendarViewModel, keepCardOptions),
  createViewConvert(calendarViewModel, tableViewModel, keepCardOptions),
  createViewConvert(tableViewModel, galleryViewModel, keepCardOptions),
  createViewConvert(galleryViewModel, tableViewModel, keepCardOptions),
  createViewConvert(kanbanViewModel, calendarViewModel, keepCardOptions),
  createViewConvert(calendarViewModel, kanbanViewModel, keepCardOptions),
  createViewConvert(kanbanViewModel, galleryViewModel, keepCardOptions),
  createViewConvert(galleryViewModel, kanbanViewModel, keepCardOptions),
  createViewConvert(calendarViewModel, galleryViewModel, keepCardOptions),
  createViewConvert(galleryViewModel, calendarViewModel, keepCardOptions),
  createViewConvert(tableViewModel, kanbanViewModel, data => ({
    filter: data.filter,
  })),
  createViewConvert(kanbanViewModel, tableViewModel, data => ({
    filter: data.filter,
    groupBy: data.groupBy,
  })),
];
