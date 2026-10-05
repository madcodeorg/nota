import { signal } from '@preact/signals-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { DataSource } from '../core/data-source/base.js';
import type { DataViewRootUILogic } from '../core/data-view.js';
import type { FilterGroup } from '../core/filter/types.js';
import type { DataViewDataType } from '../core/view/data-view.js';
import { ViewManagerBase } from '../core/view-manager/view-manager.js';
import { datePropertyModelConfig } from '../property-presets/date/define.js';
import { imagePropertyModelConfig } from '../property-presets/image/define.js';
import { textPropertyModelConfig } from '../property-presets/text/define.js';
import { CalendarSingleView } from '../view-presets/calendar/calendar-view-manager.js';
import {
  calendarDayKey,
  calendarMonth,
  calendarMonthDays,
  partitionCalendarRows,
} from '../view-presets/calendar/date-utils.js';
import type { CalendarViewData } from '../view-presets/calendar/define.js';
import {
  CalendarViewUI,
  CalendarViewUILogic,
} from '../view-presets/calendar/renderer.js';
import { CardViewSelectionWithTypeSchema } from '../view-presets/card-selection.js';
import { viewConverts } from '../view-presets/convert.js';
import { GallerySingleView } from '../view-presets/gallery/gallery-view-manager.js';
import { galleryImageSource } from '../view-presets/gallery/image-utils.js';
import {
  GalleryViewUI,
  GalleryViewUILogic,
} from '../view-presets/gallery/renderer.js';

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.replaceChildren();
});

function fixture() {
  const calendarData: CalendarViewData = {
    id: 'calendar',
    name: 'Calendar',
    mode: 'calendar',
    columns: [{ id: 'status', hide: true }],
    header: {},
    filter: { type: 'group', op: 'and', conditions: [] },
    dateColumn: 'date',
    month: '2026-10',
  };
  const galleryData = {
    ...calendarData,
    id: 'gallery',
    mode: 'gallery',
    header: { imageColumn: 'cover' },
  };
  const views = signal<DataViewDataType[]>([calendarData, galleryData]);
  const rows = signal(['one', 'two', 'three']);
  const cells = signal<Record<string, Record<string, unknown>>>({
    one: {
      title: 'First',
      status: 'Done',
      date: new Date(2026, 9, 5, 18).getTime(),
    },
    two: { title: 'Second', status: 'Todo', date: null },
    three: {
      title: 'Third',
      status: 'Done',
      date: new Date(2026, 9, 5, 9).getTime(),
    },
  });
  const readonly = signal(false);
  const cellRenderer = {
    view: () => ({ update: () => {}, unmount: () => {} }),
  };
  const textMeta = textPropertyModelConfig.createPropertyMeta({
    cellRenderer,
  });
  const metas = {
    text: textMeta,
    title: { ...textMeta, type: 'title' },
    date: datePropertyModelConfig.createPropertyMeta({ cellRenderer }),
    image: imagePropertyModelConfig.createPropertyMeta({ cellRenderer }),
  };
  const types: Record<string, keyof typeof metas> = {
    title: 'title',
    date: 'date',
    otherDate: 'date',
    status: 'text',
    cover: 'image',
  };
  const properties = signal(Object.keys(types));
  const source = {
    readonly$: readonly,
    properties$: properties,
    rows$: rows,
    viewDataList$: views,
    viewConverts,
    propertyTypeGet: (id: string) => types[id],
    propertyMetaGet: (type: keyof typeof metas) => metas[type],
    propertyNameGet: (id: string) => id,
    propertyDataGet: () => ({}),
    propertyReadonlyGet: () => false,
    cellValueGet: (rowId: string, propertyId: string) =>
      cells.value[rowId]?.[propertyId],
    cellValueChange: (rowId: string, propertyId: string, value: unknown) => {
      cells.value = {
        ...cells.value,
        [rowId]: { ...cells.value[rowId], [propertyId]: value },
      };
    },
    viewDataGet: (id: string) => views.value.find(view => view.id === id),
    viewDataUpdate: (
      id: string,
      updater: (data: DataViewDataType) => Partial<DataViewDataType>
    ) => {
      views.value = views.value.map(view =>
        view.id === id ? { ...view, ...updater(view) } : view
      );
    },
    rowAdd: () => {
      const id = `row-${rows.value.length}`;
      rows.value = [...rows.value, id];
      return id;
    },
  } as unknown as DataSource;
  const manager = new ViewManagerBase(source);
  const calendar = new CalendarSingleView(manager, 'calendar');
  const gallery = new GallerySingleView(manager, 'gallery');
  return {
    calendar,
    gallery,
    cells,
    rows,
    readonly,
    manager,
    views,
    properties,
  };
}

describe('calendar days', () => {
  test('partitions zero timestamps, invalid dates and undated rows without losing order', () => {
    const rows = [
      0,
      null,
      NaN,
      Infinity,
      '2026-10-05',
      new Date(2026, 9, 5).getTime(),
      8640000000000001,
    ];
    const result = partitionCalendarRows(rows, value => value);
    expect(result.days.get(calendarDayKey(0)!)).toEqual([0]);
    expect(result.days.get('2026-10-05')).toEqual([rows[5]]);
    expect(result.undated).toEqual([
      null,
      NaN,
      Infinity,
      '2026-10-05',
      8640000000000001,
    ]);
  });

  test('uses local day keys and local dates across daylight saving changes', () => {
    vi.stubEnv('TZ', 'America/Toronto');
    expect(calendarDayKey(new Date('2026-03-09T02:30:00Z').getTime())).toBe(
      '2026-03-08'
    );
    const days = calendarMonthDays(new Date(2026, 2, 1));
    expect(days).toHaveLength(42);
    expect(days[0]?.getDay()).toBe(1);
    expect(new Set(days.map(date => calendarDayKey(date.getTime()))).size).toBe(
      42
    );
    expect(days.every(date => date.getHours() === 0)).toBe(true);
    const before = days.find(
      date => calendarDayKey(date.getTime()) === '2026-03-08'
    )!;
    const after = days.find(
      date => calendarDayKey(date.getTime()) === '2026-03-09'
    )!;
    expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  test('handles leap-year months and invalid persisted options', () => {
    expect(
      calendarMonthDays(calendarMonth('2024-02')).some(
        date => calendarDayKey(date.getTime()) === '2024-02-29'
      )
    ).toBe(true);
    const fallback = new Date(2026, 9, 15);
    for (const invalid of ['2026-13', '2026-00', 'bad', '', undefined]) {
      expect(calendarMonth(invalid, fallback).getTime()).toBe(
        new Date(2026, 9, 1).getTime()
      );
    }
  });
});

describe('shared local database views', () => {
  test('filters hidden properties, sorts rows, and reacts to edits in both views', () => {
    const { calendar, gallery, views, cells } = fixture();
    const filter: FilterGroup = {
      type: 'group',
      op: 'and',
      conditions: [
        {
          type: 'filter',
          left: { type: 'ref', name: 'status' },
          function: 'is',
          args: [{ type: 'literal', value: 'Done' }],
        },
      ],
    };
    views.value = views.value.map(view => ({
      ...view,
      filter,
      sort: {
        sortBy: [{ ref: { type: 'ref', name: 'title' }, desc: true }],
        manuallySort: [],
      },
    }));
    expect(calendar.rows$.value.map(row => row.rowId)).toEqual([
      'three',
      'one',
    ]);
    expect(gallery.rows$.value.map(row => row.rowId)).toEqual(['three', 'one']);
    expect(
      calendar.calendarRows$.value.days.get('2026-10-05')?.map(row => row.rowId)
    ).toEqual(['three', 'one']);
    cells.value = {
      ...cells.value,
      one: { ...cells.value.one, status: 'Todo' },
    };
    expect(calendar.rows$.value.map(row => row.rowId)).toEqual(['three']);
    expect(gallery.rows$.value.map(row => row.rowId)).toEqual(['three']);
  });

  test('persists options and rejects changes on readonly views', () => {
    const { calendar, gallery, manager, views, readonly } = fixture();
    calendar.dateColumnSet('otherDate');
    calendar.monthSet(new Date(2027, 0, 1));
    gallery.propertyGetOrCreate('date').hideSet(true);
    gallery.imageColumnSet(undefined);
    // Recreate both managers, as happens after workspace reload.
    views.value = JSON.parse(JSON.stringify(views.value));
    const reloadedCalendar = new CalendarSingleView(manager, 'calendar');
    const reloadedGallery = new GallerySingleView(manager, 'gallery');
    expect(reloadedCalendar.dateProperty$.value?.id).toBe('otherDate');
    expect(reloadedCalendar.month$.value.getFullYear()).toBe(2027);
    expect(reloadedGallery.propertyGetOrCreate('date').hide$.value).toBe(true);
    expect(reloadedGallery.imageProperty$.value).toBeUndefined();
    readonly.value = true;
    const before = JSON.stringify(views.value);
    calendar.dateColumnSet('date');
    calendar.monthSet(new Date());
    gallery.imageColumnSet('cover');
    gallery.propertyGetOrCreate('date').hideSet(false);
    expect(JSON.stringify(views.value)).toBe(before);
  });

  test('falls back safely when the selected date column is deleted or changes type', () => {
    const { calendar, properties } = fixture();
    properties.value = ['title', 'otherDate', 'status', 'cover'];
    expect(calendar.dateProperty$.value?.id).toBe('otherDate');
    properties.value = ['title', 'status', 'cover'];
    expect(calendar.dateProperty$.value).toBeUndefined();
    expect(calendar.calendarRows$.value.undated.map(row => row.rowId)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  test('search narrows existing rows without duplicating canonical content', () => {
    const { calendar, gallery, rows } = fixture();
    gallery.setSearch('Second');
    expect(gallery.rows$.value.map(row => row.rowId)).toEqual(['two']);
    expect(calendar.rows$.value).toHaveLength(3);
    expect(rows.value).toEqual(['one', 'two', 'three']);
  });

  test('view conversion preserves filters, sorting, property visibility and cover choices', () => {
    const source = {
      id: 'test',
      name: 'Test',
      mode: 'table',
      columns: [
        { id: 'title', width: 350 },
        { id: 'status', hide: true, width: 160 },
      ],
      filter: { type: 'group', op: 'and', conditions: [] },
      sort: { sortBy: [], manuallySort: [] },
      header: { titleColumn: 'title', imageColumn: 'cover' },
    };
    for (const target of ['calendar', 'gallery']) {
      const converted = viewConverts
        .find(convert => convert.from === 'table' && convert.to === target)!
        .convert(source);
      expect(converted).toMatchObject({
        filter: source.filter,
        sort: source.sort,
        columns: source.columns,
        header: { imageColumn: 'cover' },
      });
      const table = viewConverts
        .find(convert => convert.from === target && convert.to === 'table')!
        .convert({ ...source, ...converted, mode: target });
      expect(table).toMatchObject({
        filter: source.filter,
        sort: source.sort,
        columns: source.columns,
      });
    }
  });
});

describe('row opening and gallery covers', () => {
  test('adding a dated row updates the same canonical rows used by Gallery', () => {
    const { calendar, gallery, cells, readonly } = fixture();
    const openDetailPanel = vi.fn();
    const root = {
      setSelection: vi.fn(),
      openDetailPanel,
      selection$: signal(undefined),
      config: {},
    } as unknown as DataViewRootUILogic;
    const logic = new CalendarViewUILogic(root, calendar);
    const date = new Date(2026, 9, 12);
    logic.addAtDate(date);
    expect(cells.value['row-3']?.date).toBe(date.getTime());
    expect(
      calendar.calendarRows$.value.days.get('2026-10-12')?.[0]?.rowId
    ).toBe('row-3');
    expect(gallery.rows$.value.map(row => row.rowId)).toContain('row-3');
    expect(openDetailPanel).toHaveBeenCalledWith({
      view: calendar,
      rowId: 'row-3',
    });
    readonly.value = true;
    logic.addAtDate(date);
    expect(gallery.rows$.value).toHaveLength(4);
  });

  test('month navigation crosses years and works without mutating a readonly workspace', () => {
    const { calendar, views, readonly } = fixture();
    const root = { config: {} } as unknown as DataViewRootUILogic;
    const logic = new CalendarViewUILogic(root, calendar);
    logic.monthSet(new Date(2026, 11, 1));
    logic.moveMonth(1);
    expect(logic.month$.value.getFullYear()).toBe(2027);
    expect(logic.month$.value.getMonth()).toBe(0);
    readonly.value = true;
    const before = JSON.stringify(views.value);
    logic.moveMonth(-1);
    expect(logic.month$.value.getFullYear()).toBe(2026);
    expect(logic.month$.value.getMonth()).toBe(11);
    expect(JSON.stringify(views.value)).toBe(before);
  });

  test('row selection serializes for Calendar and Gallery', () => {
    for (const type of ['calendar', 'gallery']) {
      const selection = { viewId: 'v', type, selectionType: 'row', rowId: 'r' };
      expect(
        CardViewSelectionWithTypeSchema.parse(
          JSON.parse(JSON.stringify(selection))
        )
      ).toEqual(selection);
    }
    expect(
      CardViewSelectionWithTypeSchema.safeParse({
        viewId: 'v',
        type: 'calendar',
        selectionType: 'row',
      }).success
    ).toBe(false);
  });

  test('only accepts supported image sources', () => {
    expect(galleryImageSource('https://example.test/cover.png')).toBe(
      'https://example.test/cover.png'
    );
    expect(galleryImageSource('blob:local-cover')).toBe('blob:local-cover');
    expect(galleryImageSource('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc'
    );
    for (const source of [
      'javascript:alert(1)',
      'data:text/html;base64,abc',
      '/private/file',
      null,
      {},
    ])
      expect(galleryImageSource(source)).toBeUndefined();
  });

  test('native row buttons are keyboard focusable and open shared row details', async () => {
    if (!customElements.get('dv-calendar-view-ui'))
      customElements.define('dv-calendar-view-ui', CalendarViewUI);
    if (!customElements.get('dv-gallery-view-ui'))
      customElements.define('dv-gallery-view-ui', GalleryViewUI);
    const { calendar, gallery } = fixture();
    calendar.dateColumnSet('otherDate');
    const setSelection = vi.fn();
    const openDetailPanel = vi.fn();
    const root = {
      setSelection,
      openDetailPanel,
      selection$: signal(undefined),
      config: {},
    } as unknown as DataViewRootUILogic;
    for (const view of [calendar, gallery]) {
      const element = document.createElement(
        view.type === 'calendar' ? 'dv-calendar-view-ui' : 'dv-gallery-view-ui'
      );
      const logic =
        view instanceof CalendarSingleView
          ? new CalendarViewUILogic(root, view)
          : new GalleryViewUILogic(root, view);
      (element as CalendarViewUI | GalleryViewUI).logic = logic as never;
      document.body.append(element);
      await (element as CalendarViewUI).updateComplete;
      expect(element.querySelector('select')?.value).toBe(
        view.type === 'calendar' ? 'otherDate' : 'cover'
      );
      logic.focusFirstCell();
      const button = element.querySelector<HTMLButtonElement>('[data-row-id]')!;
      expect(document.activeElement).toBe(button);
      expect(button.tagName).toBe('BUTTON');
      button.click();
      expect(openDetailPanel).toHaveBeenLastCalledWith({
        view,
        rowId: button.dataset.rowId,
      });
      expect(setSelection).toHaveBeenLastCalledWith({
        viewId: view.id,
        type: view.type,
        selectionType: 'row',
        rowId: button.dataset.rowId,
      });
      element.remove();
    }
  });
});
