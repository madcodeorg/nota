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
  calendarDayKeys,
  calendarMonth,
  calendarMonthDays,
  calendarTimeBadge,
  calendarWeekDays,
  calendarWeekStart,
  moveCalendarDateValue,
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

function fixture(getBlob?: (id: string) => Promise<Blob | null>) {
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
    attachment: { ...textMeta, type: 'attachment' },
  };
  const types: Record<string, keyof typeof metas> = {
    title: 'title',
    date: 'date',
    otherDate: 'date',
    status: 'text',
    cover: 'image',
    files: 'attachment',
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
    serviceGet: () => (getBlob ? { blobSync: { get: getBlob } } : null),
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

  test('calculates Monday-first week days safely across DST transitions and invalid anchors', () => {
    vi.stubEnv('TZ', 'America/Toronto');
    const dstWeek = calendarWeekDays(new Date(2026, 2, 8)); // Sunday of DST spring-forward
    expect(dstWeek).toHaveLength(7);
    expect(dstWeek[0]?.getDay()).toBe(1);
    expect(dstWeek[6]?.getDay()).toBe(0);
    expect(dstWeek.map(date => calendarDayKey(date.getTime()))).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ]);
    expect(dstWeek.every(date => date.getHours() === 0)).toBe(true);

    const nextWeek = calendarWeekDays(new Date(2026, 2, 9));
    expect(nextWeek.map(date => calendarDayKey(date.getTime()))).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ]);

    expect(calendarDayKey(calendarWeekStart('2026-10-08').getTime())).toBe(
      '2026-10-05'
    );
    const fallback = new Date(2026, 9, 15); // Thu Oct 15 -> Mon Oct 12
    for (const invalid of [
      '2026-02-30',
      '2026-13-01',
      '2026-00-01',
      'bad',
      '',
      undefined,
    ]) {
      expect(
        calendarDayKey(calendarWeekStart(invalid, fallback).getTime())
      ).toBe('2026-10-12');
    }
  });

  test('expands date ranges, exposes time badges, and handles invalid or reversed ranges', () => {
    vi.stubEnv('TZ', 'America/Toronto');
    const plain = new Date(2026, 9, 5, 14, 30).getTime();
    expect(calendarDayKeys(plain)).toEqual(['2026-10-05']);
    expect(calendarTimeBadge(plain)).toBeUndefined();

    const range = {
      start: new Date(2026, 2, 7, 9, 5).getTime(),
      end: new Date(2026, 2, 9, 17, 45).getTime(),
      includeTime: true,
    };
    expect(calendarDayKey(range)).toBe('2026-03-07');
    expect(calendarDayKeys(range)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(calendarTimeBadge(range)).toBe('09:05');

    const singleWithTime = {
      start: new Date(2026, 9, 6, 18, 0).getTime(),
      includeTime: true,
    };
    expect(calendarDayKeys(singleWithTime)).toEqual(['2026-10-06']);
    expect(calendarTimeBadge(singleWithTime)).toBe('18:00');
    expect(
      calendarTimeBadge({
        start: new Date(2026, 9, 6, 18, 0).getTime(),
        includeTime: false,
      })
    ).toBeUndefined();

    const reversed = {
      start: new Date(2026, 9, 10, 12, 0).getTime(),
      end: new Date(2026, 9, 8, 9, 0).getTime(),
    };
    expect(calendarDayKeys(reversed)).toEqual(['2026-10-10']);

    const hugeRange = {
      start: new Date(2026, 0, 1).getTime(),
      end: new Date(2029, 0, 1).getTime(),
    };
    expect(calendarDayKeys(hugeRange)).toHaveLength(366);

    for (const invalid of [
      null,
      undefined,
      NaN,
      { start: NaN },
      { start: '2026-10-05' },
    ]) {
      expect(calendarDayKeys(invalid)).toEqual([]);
      expect(calendarDayKey(invalid)).toBeUndefined();
      expect(calendarTimeBadge(invalid)).toBeUndefined();
    }

    const rows = [
      { id: 'plain', date: plain },
      { id: 'range', date: range },
      { id: 'reversed', date: reversed },
      { id: 'undated', date: null },
      { id: 'invalid', date: { start: NaN } },
    ];
    const partitioned = partitionCalendarRows(rows, row => row.date);
    expect(partitioned.days.get('2026-10-05')?.map(r => r.id)).toEqual([
      'plain',
    ]);
    expect(partitioned.days.get('2026-03-07')?.map(r => r.id)).toEqual([
      'range',
    ]);
    expect(partitioned.days.get('2026-03-08')?.map(r => r.id)).toEqual([
      'range',
    ]);
    expect(partitioned.days.get('2026-03-09')?.map(r => r.id)).toEqual([
      'range',
    ]);
    expect(partitioned.days.get('2026-10-10')?.map(r => r.id)).toEqual([
      'reversed',
    ]);
    expect(partitioned.undated.map(r => r.id)).toEqual(['undated', 'invalid']);
  });

  test('moves undated, plain number, and range date values while preserving time and duration', () => {
    vi.stubEnv('TZ', 'America/Toronto');
    const target = new Date(2026, 9, 12);

    // Undated -> local start-of-day
    expect(moveCalendarDateValue(null, target)).toBe(
      new Date(2026, 9, 12, 0, 0, 0, 0).getTime()
    );
    expect(moveCalendarDateValue(undefined, target)).toBe(
      new Date(2026, 9, 12, 0, 0, 0, 0).getTime()
    );

    // Plain number -> preserves local time-of-day
    const plainSource = new Date(2026, 9, 5, 14, 35, 12).getTime();
    expect(moveCalendarDateValue(plainSource, target)).toBe(
      new Date(2026, 9, 12, 14, 35, 12).getTime()
    );

    // Multi-day range across DST -> preserves calendar duration, local times, and includeTime
    const rangeSource = {
      start: new Date(2026, 2, 7, 9, 30).getTime(),
      end: new Date(2026, 2, 9, 17, 45).getTime(),
      includeTime: true,
    };
    const movedRange = moveCalendarDateValue(
      rangeSource,
      new Date(2026, 2, 10)
    );
    expect(movedRange).toEqual({
      start: new Date(2026, 2, 10, 9, 30).getTime(),
      end: new Date(2026, 2, 12, 17, 45).getTime(),
      includeTime: true,
    });

    // Single-day range object without end -> preserves includeTime without adding end
    const singleRange = {
      start: new Date(2026, 9, 5, 8, 15).getTime(),
      includeTime: true,
    };
    expect(moveCalendarDateValue(singleRange, target)).toEqual({
      start: new Date(2026, 9, 12, 8, 15).getTime(),
      includeTime: true,
    });
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
  test('renders a local attachment cover through the workspace blob service and revokes it on removal', async () => {
    if (!customElements.get('dv-gallery-view-ui'))
      customElements.define('dv-gallery-view-ui', GalleryViewUI);
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:local-gallery');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const get = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
    const { gallery, cells } = fixture(get);
    gallery.imageColumnSet('files');
    expect(gallery.imageProperties$.value.map(property => property.id)).toEqual(
      ['cover', 'files']
    );
    cells.value = {
      ...cells.value,
      one: {
        ...cells.value.one,
        files: {
          image: {
            id: 'image',
            name: 'cover.png',
            mime: 'image/png',
            order: 'a',
          },
        },
      },
    };
    const root = {
      setSelection: vi.fn(),
      openDetailPanel: vi.fn(),
      selection$: signal(undefined),
      config: {},
    } as unknown as DataViewRootUILogic;
    const element = document.createElement('dv-gallery-view-ui');
    element.logic = new GalleryViewUILogic(root, gallery);
    document.body.append(element);
    await vi.waitFor(() =>
      expect(element.querySelector('img')?.getAttribute('src')).toBe(
        'blob:local-gallery'
      )
    );
    expect(get).toHaveBeenCalledExactlyOnceWith('image');
    expect(create).toHaveBeenCalledOnce();
    element.remove();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:local-gallery');
    expect(removeListener).toHaveBeenCalledWith(
      'online',
      expect.any(Function),
      undefined
    );
    vi.restoreAllMocks();
  });

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

  test('switches between Month and Week views, steps by 7 days in Week mode, and stays local in readonly mode', async () => {
    if (!customElements.get('dv-calendar-view-ui'))
      customElements.define('dv-calendar-view-ui', CalendarViewUI);
    const { calendar, manager, views, readonly } = fixture();
    expect(calendar.modeScope$.value).toBe('month');
    const root = {
      setSelection: vi.fn(),
      openDetailPanel: vi.fn(),
      selection$: signal(undefined),
      config: {},
    } as unknown as DataViewRootUILogic;
    const logic = new CalendarViewUILogic(root, calendar);
    const element = document.createElement('dv-calendar-view-ui');
    element.logic = logic;
    document.body.append(element);
    await element.updateComplete;

    expect(element.querySelectorAll('.calendar-day')).toHaveLength(42);

    // Switch to Week mode via toolbar button
    element
      .querySelector<HTMLButtonElement>('[data-calendar-scope="week"]')!
      .click();
    await element.updateComplete;
    expect(calendar.modeScope$.value).toBe('week');
    expect(element.querySelectorAll('.calendar-day')).toHaveLength(7);

    // Step forward and backward by 7 days in Week mode
    logic.weekStartSet(new Date(2026, 9, 5));
    await element.updateComplete;
    expect(
      Array.from(element.querySelectorAll<HTMLElement>('.calendar-day')).map(
        day => day.dataset.dayKey
      )
    ).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);

    logic.movePeriod(1);
    await element.updateComplete;
    expect(calendarDayKey(logic.weekStart$.value.getTime())).toBe('2026-10-12');
    logic.movePeriod(-1);
    expect(calendarDayKey(logic.weekStart$.value.getTime())).toBe('2026-10-05');

    // Persistence across reload
    views.value = JSON.parse(JSON.stringify(views.value));
    const reloaded = new CalendarSingleView(manager, 'calendar');
    expect(reloaded.modeScope$.value).toBe('week');
    expect(calendarDayKey(reloaded.weekStart$.value.getTime())).toBe(
      '2026-10-05'
    );

    // Readonly navigation does not mutate persisted view data
    readonly.value = true;
    const before = JSON.stringify(views.value);
    logic.movePeriod(1);
    expect(calendarDayKey(logic.weekStart$.value.getTime())).toBe('2026-10-12');
    logic.modeScopeSet('month');
    expect(logic.modeScope$.value).toBe('month');
    expect(JSON.stringify(views.value)).toBe(before);
    element.remove();
  });

  test('reschedules dated, undated, and multi-day cards via drag-and-drop and renders time badges and visible property pills', async () => {
    if (!customElements.get('dv-calendar-view-ui'))
      customElements.define('dv-calendar-view-ui', CalendarViewUI);
    const { calendar, cells, readonly } = fixture();
    // Unhide status so it shows as a property pill on calendar cards
    calendar.propertyGetOrCreate('status').hideSet(false);
    // Give row 'three' a multi-day range with time
    cells.value = {
      ...cells.value,
      three: {
        ...cells.value.three,
        date: {
          start: new Date(2026, 9, 5, 9, 30).getTime(),
          end: new Date(2026, 9, 7, 16, 0).getTime(),
          includeTime: true,
        },
      },
    };
    const openDetailPanel = vi.fn();
    const root = {
      setSelection: vi.fn(),
      openDetailPanel,
      selection$: signal(undefined),
      config: {},
    } as unknown as DataViewRootUILogic;
    const logic = new CalendarViewUILogic(root, calendar);
    const element = document.createElement('dv-calendar-view-ui');
    element.logic = logic;
    document.body.append(element);
    await element.updateComplete;

    // Multi-day row renders on Oct 5, 6, 7 with time badge on start day and visible property pill
    const oct5 = element.querySelector<HTMLElement>(
      '[data-day-key="2026-10-05"]'
    )!;
    const oct6 = element.querySelector<HTMLElement>(
      '[data-day-key="2026-10-06"]'
    )!;
    const oct7 = element.querySelector<HTMLElement>(
      '[data-day-key="2026-10-07"]'
    )!;
    const startCard = oct5.querySelector<HTMLButtonElement>(
      '[data-row-id="three"]'
    )!;
    expect(startCard.getAttribute('draggable')).toBe('true');
    expect(startCard.dataset.rangePosition).toBe('start');
    expect(startCard.querySelector('.calendar-row-time')?.textContent).toBe(
      '09:30'
    );
    expect(
      startCard.querySelector('[data-property-id="status"]')?.textContent
    ).toBe('Done');
    expect(
      oct6.querySelector<HTMLButtonElement>('[data-row-id="three"]')?.dataset
        .rangePosition
    ).toBe('middle');
    expect(
      oct7.querySelector<HTMLButtonElement>('[data-row-id="three"]')?.dataset
        .rangePosition
    ).toBe('end');

    // Hiding the column removes its pill from calendar cards
    calendar.propertyGetOrCreate('status').hideSet(true);
    await element.updateComplete;
    expect(element.querySelector('[data-property-id="status"]')).toBeNull();

    // Drag-and-drop an undated card ('two') onto Oct 12
    const undatedCard = element.querySelector<HTMLButtonElement>(
      '.calendar-undated [data-row-id="two"]'
    )!;
    const oct12 = element.querySelector<HTMLElement>(
      '[data-day-key="2026-10-12"]'
    )!;
    undatedCard.dispatchEvent(new Event('dragstart', { bubbles: true }));
    oct12.dispatchEvent(
      new Event('dragover', { bubbles: true, cancelable: true })
    );
    await element.updateComplete;
    expect(oct12.dataset.dropTarget).toBe('true');
    oct12.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await element.updateComplete;
    expect(oct12.dataset.dropTarget).toBe('false');
    expect(cells.value.two?.date).toBe(new Date(2026, 9, 12, 0, 0).getTime());

    // Drag-and-drop multi-day card ('three') onto Oct 10 preserves duration & includeTime
    const oct10 = element.querySelector<HTMLElement>(
      '[data-day-key="2026-10-10"]'
    )!;
    oct5
      .querySelector<HTMLButtonElement>('[data-row-id="three"]')!
      .dispatchEvent(new Event('dragstart', { bubbles: true }));
    oct10.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await element.updateComplete;
    expect(cells.value.three?.date).toEqual({
      start: new Date(2026, 9, 10, 9, 30).getTime(),
      end: new Date(2026, 9, 12, 16, 0).getTime(),
      includeTime: true,
    });

    // Drag-and-drop is blocked when readonly
    readonly.value = true;
    await element.updateComplete;
    const beforeDate = cells.value.one?.date;
    logic.moveRowToDate('one', new Date(2026, 9, 20));
    expect(cells.value.one?.date).toBe(beforeDate);
    expect(
      element
        .querySelector<HTMLButtonElement>('[data-row-id="one"]')!
        .getAttribute('draggable')
    ).toBe('false');

    // Clicking card still opens detail panel
    element.querySelector<HTMLButtonElement>('[data-row-id="one"]')!.click();
    expect(openDetailPanel).toHaveBeenLastCalledWith({
      view: calendar,
      rowId: 'one',
    });
    element.remove();
  });

  test('supports persisted Gallery cardSize and coverFit options with defaults and UI controls', async () => {
    if (!customElements.get('dv-gallery-view-ui'))
      customElements.define('dv-gallery-view-ui', GalleryViewUI);
    const { gallery, manager, views, readonly, cells } = fixture();
    expect(gallery.cardSize$.value).toBe('medium');
    expect(gallery.coverFit$.value).toBe('cover');

    cells.value = {
      ...cells.value,
      one: { ...cells.value.one, cover: 'https://example.test/cover.png' },
    };

    const root = {
      setSelection: vi.fn(),
      openDetailPanel: vi.fn(),
      selection$: signal(undefined),
      config: {},
    } as unknown as DataViewRootUILogic;
    const element = document.createElement('dv-gallery-view-ui');
    element.logic = new GalleryViewUILogic(root, gallery);
    document.body.append(element);
    await element.updateComplete;

    const cardsGrid = element.querySelector<HTMLElement>('.gallery-cards')!;
    const sizeSelect = element.querySelector<HTMLSelectElement>(
      'select[aria-label="Gallery card size"]'
    )!;
    const fitSelect = element.querySelector<HTMLSelectElement>(
      'select[aria-label="Gallery cover fit"]'
    )!;
    expect(cardsGrid.dataset.cardSize).toBe('medium');
    expect(cardsGrid.dataset.coverFit).toBe('cover');
    expect(sizeSelect.value).toBe('medium');
    expect(fitSelect.value).toBe('cover');

    sizeSelect.value = 'large';
    sizeSelect.dispatchEvent(new Event('change'));
    fitSelect.value = 'contain';
    fitSelect.dispatchEvent(new Event('change'));
    await element.updateComplete;

    expect(gallery.cardSize$.value).toBe('large');
    expect(gallery.coverFit$.value).toBe('contain');
    expect(cardsGrid.dataset.cardSize).toBe('large');
    expect(cardsGrid.dataset.coverFit).toBe('contain');
    expect(
      element.querySelector<HTMLImageElement>('.gallery-cover')?.dataset
        .coverFit
    ).toBe('contain');

    // Survives reload
    views.value = JSON.parse(JSON.stringify(views.value));
    const reloaded = new GallerySingleView(manager, 'gallery');
    expect(reloaded.cardSize$.value).toBe('large');
    expect(reloaded.coverFit$.value).toBe('contain');

    // Rejects mutations when readonly and falls back safely on invalid values
    readonly.value = true;
    reloaded.cardSizeSet('small');
    reloaded.coverFitSet('cover');
    expect(reloaded.cardSize$.value).toBe('large');
    expect(reloaded.coverFit$.value).toBe('contain');

    readonly.value = false;
    reloaded.cardSizeSet('invalid' as never);
    reloaded.coverFitSet('invalid' as never);
    expect(reloaded.cardSize$.value).toBe('large');
    expect(reloaded.coverFit$.value).toBe('contain');
    element.remove();
  });
});
