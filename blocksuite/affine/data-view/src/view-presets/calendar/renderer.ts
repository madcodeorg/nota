import { css } from '@emotion/css';
import { computed, signal } from '@preact/signals-core';
import { html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../core/utils/uni-component/uni-component.js';
import { DataViewUIBase } from '../../core/view/data-view-base.js';
import type { CardProperty } from '../card-view-manager.js';
import { CardViewUILogic } from '../card-view-ui.js';
import type { CalendarSingleView } from './calendar-view-manager.js';
import {
  calendarDayKey,
  calendarDayKeys,
  calendarMonthDays,
  calendarTimeBadge,
  calendarWeekDays,
  calendarWeekStart,
} from './date-utils.js';
import type { CalendarViewScope } from './define.js';

const CALENDAR_ROW_DRAG_MIME = 'application/x-nota-calendar-row';
const MAX_CARD_PILLS = 3;

type CalendarCardPill = {
  id: string;
  name: string;
  value: string;
};

export class CalendarViewUILogic extends CardViewUILogic<CalendarSingleView> {
  private readonly localMonth$ = signal<Date | undefined>(undefined);
  private readonly localModeScope$ = signal<CalendarViewScope | undefined>(
    undefined
  );
  private readonly localWeekStart$ = signal<Date | undefined>(undefined);

  month$ = computed(() => this.localMonth$.value ?? this.view.month$.value);
  modeScope$ = computed(
    () => this.localModeScope$.value ?? this.view.modeScope$.value
  );
  weekStart$ = computed(
    () => this.localWeekStart$.value ?? this.view.weekStart$.value
  );

  monthSet = (month: Date) => {
    const normalized = new Date(month.getFullYear(), month.getMonth(), 1);
    if (this.view.readonly$.value) this.localMonth$.value = normalized;
    else {
      this.localMonth$.value = undefined;
      this.view.monthSet(normalized);
    }
  };

  modeScopeSet = (scope: CalendarViewScope) => {
    if (scope !== 'month' && scope !== 'week') return;
    if (this.view.readonly$.value) {
      this.localModeScope$.value = scope;
      if (scope === 'week' && !this.localWeekStart$.value) {
        this.localWeekStart$.value = this.localMonth$.value
          ? calendarWeekStart(this.localMonth$.value)
          : this.view.weekStart$.value;
      }
    } else {
      this.localModeScope$.value = undefined;
      this.view.modeScopeSet(scope);
    }
  };

  weekStartSet = (date: Date) => {
    const start = calendarWeekStart(date);
    if (this.view.readonly$.value) {
      this.localWeekStart$.value = start;
      this.localMonth$.value = new Date(date.getFullYear(), date.getMonth(), 1);
    } else {
      this.localWeekStart$.value = undefined;
      this.localMonth$.value = undefined;
      this.view.weekStartSet(date);
    }
  };

  moveMonth = (offset: number) => {
    const month = this.month$.value;
    this.monthSet(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  };

  moveWeek = (offset: number) => {
    const start = this.weekStart$.value;
    this.weekStartSet(
      new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + offset * 7
      )
    );
  };

  movePeriod = (offset: number) => {
    if (this.modeScope$.value === 'week') this.moveWeek(offset);
    else this.moveMonth(offset);
  };

  goToToday = () => {
    const today = new Date();
    if (this.modeScope$.value === 'week') this.weekStartSet(today);
    else this.monthSet(today);
  };

  addAtDate = (date: Date) => {
    if (this.view.readonly$.value) return;
    const property = this.view.dateProperty$.value;
    if (!property) return;
    const id = this.view.rowAdd('end');
    property.valueSet(id, date.getTime());
    this.openRow(id);
  };

  moveRowToDate = (rowId: string, targetDate: Date) => {
    this.view.moveRowToDate(rowId, targetDate);
  };

  renderer = createUniComponentFromWebComponent(CalendarViewUI);
}

export class CalendarViewUI extends DataViewUIBase<CalendarViewUILogic> {
  private draggingRowId?: string;
  private readonly dropTargetDayKey$ = signal<string | undefined>(undefined);

  override connectedCallback(): void {
    super.connectedCallback();
    this.logic.ui$.value = this;
    this.classList.add(calendarStyle);
  }

  override disconnectedCallback(): void {
    this.draggingRowId = undefined;
    this.dropTargetDayKey$.value = undefined;
    if (this.logic.ui$.value === this) this.logic.ui$.value = undefined;
    super.disconnectedCallback();
  }

  private getCardPills(
    rowId: string,
    cardProperties: CardProperty[]
  ): CalendarCardPill[] {
    const pills: CalendarCardPill[] = [];
    for (const property of cardProperties) {
      if (pills.length >= MAX_CARD_PILLS) break;
      const type = property.type$.value;
      if (type === 'image' || type === 'attachment') continue;
      const cell = property.cellGetOrCreate(rowId);
      const raw = cell.value$.value;
      if (raw == null) continue;
      let value = '';
      if (type === 'date') {
        const keys = calendarDayKeys(raw);
        if (keys.length === 0) continue;
        value =
          keys.length > 1 ? `${keys[0]} – ${keys[keys.length - 1]}` : keys[0]!;
      } else if (type === 'checkbox') {
        if (raw !== true) continue;
        value = `✓ ${property.name$.value}`;
      } else {
        const text = cell.stringValue$.value;
        if (typeof text !== 'string') continue;
        value = text.trim();
      }
      if (!value) continue;
      pills.push({ id: property.id, name: property.name$.value, value });
    }
    return pills;
  }

  private handleDragStart(event: DragEvent, rowId: string) {
    const view = this.logic.view;
    if (view.readonly$.value || !view.dateProperty$.value) {
      event.preventDefault();
      return;
    }
    this.draggingRowId = rowId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(CALENDAR_ROW_DRAG_MIME, rowId);
      event.dataTransfer.setData('text/plain', rowId);
    }
  }

  private handleDragEnd() {
    this.draggingRowId = undefined;
    this.dropTargetDayKey$.value = undefined;
  }

  private handleDayDragOver(event: DragEvent, dayKey: string) {
    const view = this.logic.view;
    if (view.readonly$.value || !view.dateProperty$.value) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (this.dropTargetDayKey$.value !== dayKey) {
      this.dropTargetDayKey$.value = dayKey;
    }
  }

  private handleDayDragLeave(event: DragEvent, dayKey: string) {
    const related = event.relatedTarget as Node | null;
    if (related && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    if (this.dropTargetDayKey$.value === dayKey) {
      this.dropTargetDayKey$.value = undefined;
    }
  }

  private handleDayDrop(event: DragEvent, targetDate: Date) {
    event.preventDefault();
    this.dropTargetDayKey$.value = undefined;
    const rowId =
      event.dataTransfer?.getData(CALENDAR_ROW_DRAG_MIME) ||
      event.dataTransfer?.getData('text/plain') ||
      this.draggingRowId;
    this.draggingRowId = undefined;
    if (!rowId) return;
    this.logic.moveRowToDate(rowId, targetDate);
  }

  private renderRow(
    rowId: string,
    cardProperties: CardProperty[],
    dayKey?: string
  ) {
    const view = this.logic.view;
    const dateProperty = view.dateProperty$.value;
    const canDrag = !view.readonly$.value && !!dateProperty;
    const dateValue = dateProperty?.valueGet(rowId);
    const dayKeys = calendarDayKeys(dateValue);
    const isMultiDay = !!dayKey && dayKeys.length > 1;
    const rangePosition = isMultiDay
      ? dayKey === dayKeys[0]
        ? 'start'
        : dayKey === dayKeys[dayKeys.length - 1]
          ? 'end'
          : 'middle'
      : undefined;
    const rawTimeBadge = calendarTimeBadge(dateValue);
    const timeBadge =
      rawTimeBadge && (!isMultiDay || rangePosition === 'start')
        ? rawTimeBadge
        : undefined;
    const pills = this.getCardPills(rowId, cardProperties);
    const title = view.titleGet(rowId);

    return html`<button
      type="button"
      class="calendar-row"
      data-row-id=${rowId}
      data-range-position=${ifDefined(rangePosition)}
      draggable=${canDrag ? 'true' : 'false'}
      title=${title}
      @dragstart=${(event: DragEvent) => this.handleDragStart(event, rowId)}
      @dragend=${() => this.handleDragEnd()}
      @click=${(event: MouseEvent) => {
        event.stopPropagation();
        this.logic.openRow(rowId);
      }}
    >
      <span class="calendar-row-head">
        ${
          timeBadge
            ? html`<span class="calendar-row-time">${timeBadge}</span>`
            : ''
        }
        <span class="calendar-row-title">${title}</span>
      </span>
      ${
        pills.length > 0
          ? html`<span class="calendar-row-pills">
              ${pills.map(
                pill =>
                  html`<span
                    class="calendar-row-pill"
                    data-property-id=${pill.id}
                    title=${`${pill.name}: ${pill.value}`}
                    >${pill.value}</span
                  >`
              )}
            </span>`
          : ''
      }
    </button>`;
  }

  override render(): TemplateResult {
    const view = this.logic.view;
    const month = this.logic.month$.value;
    const modeScope = this.logic.modeScope$.value;
    const weekStart = this.logic.weekStart$.value;
    const { days, undated } = view.calendarRows$.value;
    const readonly = view.readonly$.value;
    const dateProperty = view.dateProperty$.value;
    const titleProperty = view.mainProperties$.value.titleColumn;
    const cardProperties = view.properties$.value.filter(
      property =>
        property.id !== titleProperty &&
        property.type$.value !== 'title' &&
        property.id !== dateProperty?.id
    );
    const visibleDays =
      modeScope === 'week'
        ? calendarWeekDays(weekStart)
        : calendarMonthDays(month);
    const firstDay = visibleDays[0]!;
    const lastDay = visibleDays[visibleDays.length - 1]!;
    const periodLabel =
      modeScope === 'week'
        ? `${firstDay.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            ...(firstDay.getFullYear() !== lastDay.getFullYear()
              ? { year: 'numeric' }
              : {}),
          })} – ${lastDay.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}`
        : month.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          });
    const todayKey = calendarDayKey(Date.now());
    const dropTargetDayKey = this.dropTargetDayKey$.value;

    return html`
      ${renderUniLit(this.logic.headerWidget, { dataViewLogic: this.logic })}
      <div class="calendar-toolbar">
        <button
          type="button"
          aria-label=${
            modeScope === 'week' ? 'Previous week' : 'Previous month'
          }
          @click=${() => this.logic.movePeriod(-1)}
        >
          ‹
        </button>
        <strong aria-live="polite">${periodLabel}</strong>
        <button
          type="button"
          aria-label=${modeScope === 'week' ? 'Next week' : 'Next month'}
          @click=${() => this.logic.movePeriod(1)}
        >
          ›
        </button>
        <button type="button" @click=${() => this.logic.goToToday()}>
          Today
        </button>
        <div
          class="calendar-scope-toggle"
          role="group"
          aria-label="Calendar view range"
        >
          <button
            type="button"
            data-calendar-scope="month"
            aria-pressed=${modeScope === 'month' ? 'true' : 'false'}
            @click=${() => this.logic.modeScopeSet('month')}
          >
            Month
          </button>
          <button
            type="button"
            data-calendar-scope="week"
            aria-pressed=${modeScope === 'week' ? 'true' : 'false'}
            @click=${() => this.logic.modeScopeSet('week')}
          >
            Week
          </button>
        </div>
        <label>
          Date property
          <select
            aria-label="Calendar date property"
            .value=${dateProperty?.id ?? ''}
            ?disabled=${readonly || !dateProperty}
            @change=${(event: Event) =>
              view.dateColumnSet((event.target as HTMLSelectElement).value)}
          >
            ${
              !dateProperty
                ? html`<option value="">No date property</option>`
                : ''
            }
            ${view.dateProperties$.value.map(
              property =>
                html`<option
                  value=${property.id}
                  .selected=${property.id === dateProperty?.id}
                >
                  ${property.name$.value}
                </option>`
            )}
          </select>
        </label>
      </div>
      ${
        !dateProperty
          ? html`<p>
              Add a Date property to schedule rows. All rows are available
              below.
            </p>`
          : ''
      }
      <div class="calendar-scroll">
        <div
          class="calendar-grid"
          data-scope=${modeScope}
          role="group"
          aria-label=${periodLabel}
        >
          ${Array.from({ length: 7 }, (_, index) => {
            const day = new Date(2024, 0, 1 + index);
            return html`<span class="calendar-weekday"
              >${day.toLocaleDateString(undefined, { weekday: 'short' })}</span
            >`;
          })}
          ${repeat(
            visibleDays,
            date => date.getTime(),
            date => {
              const key = calendarDayKey(date.getTime())!;
              const label = date.toLocaleDateString(undefined, {
                dateStyle: 'full',
              });
              const dayText =
                modeScope === 'week'
                  ? date.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : String(date.getDate());
              return html`<section
                class="calendar-day"
                data-day-key=${key}
                data-outside-month=${
                  modeScope === 'month' && date.getMonth() !== month.getMonth()
                }
                data-today=${key === todayKey}
                data-drop-target=${dropTargetDayKey === key}
                aria-label=${label}
                @dragover=${(event: DragEvent) =>
                  this.handleDayDragOver(event, key)}
                @dragleave=${(event: DragEvent) =>
                  this.handleDayDragLeave(event, key)}
                @drop=${(event: DragEvent) => this.handleDayDrop(event, date)}
              >
                <div class="calendar-day-header">
                  <time datetime=${key}>${dayText}</time>
                  ${
                    !readonly && dateProperty
                      ? html`<button
                          type="button"
                          class="calendar-add"
                          aria-label=${`Add row on ${label}`}
                          @click=${() => this.logic.addAtDate(date)}
                        >
                          +
                        </button>`
                      : ''
                  }
                </div>
                ${repeat(
                  days.get(key) ?? [],
                  row => row.rowId,
                  row => this.renderRow(row.rowId, cardProperties, key)
                )}
              </section>`;
            }
          )}
        </div>
      </div>
      <section class="calendar-undated" aria-label="Undated rows">
        <strong>Undated (${undated.length})</strong>
        <div>
          ${repeat(
            undated,
            row => row.rowId,
            row => this.renderRow(row.rowId, cardProperties)
          )}
        </div>
      </section>
    `;
  }
}

export function calendarEffects() {
  customElements.define('dv-calendar-view-ui', CalendarViewUI);
}

const calendarStyle = css({
  display: 'block',
  color: 'var(--affine-text-primary-color)',
  'button, select': {
    color: 'inherit',
    font: 'inherit',
    background: 'var(--affine-background-secondary-color)',
    border: '1px solid var(--affine-border-color)',
    borderRadius: '4px',
    padding: '4px 8px',
  },
  button: { cursor: 'pointer' },
  'button:focus-visible, select:focus-visible': {
    outline: '2px solid var(--affine-primary-color)',
    outlineOffset: '2px',
  },
  '.calendar-toolbar': {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
    margin: '12px 0',
  },
  '.calendar-scope-toggle': {
    display: 'inline-flex',
    gap: '2px',
  },
  '.calendar-scope-toggle button[aria-pressed=true]': {
    background: 'var(--affine-primary-color)',
    borderColor: 'var(--affine-primary-color)',
    color: 'var(--affine-pure-white)',
  },
  '.calendar-toolbar label': {
    marginLeft: 'auto',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  '.calendar-scroll': { overflowX: 'auto' },
  '.calendar-grid': {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    minWidth: '560px',
    borderLeft: '1px solid var(--affine-border-color)',
  },
  '.calendar-weekday': {
    textAlign: 'center',
    padding: '8px',
    borderBottom: '1px solid var(--affine-border-color)',
  },
  '.calendar-day': {
    minHeight: '100px',
    padding: '6px',
    borderRight: '1px solid var(--affine-border-color)',
    borderBottom: '1px solid var(--affine-border-color)',
    transition: 'background-color 120ms ease',
  },
  '.calendar-grid[data-scope=week] .calendar-day': {
    minHeight: '220px',
  },
  '.calendar-day[data-outside-month=true]': {
    background: 'var(--affine-background-secondary-color)',
  },
  '.calendar-day[data-drop-target=true]': {
    background: 'var(--affine-hover-color)',
    outline: '2px solid var(--affine-primary-color)',
    outlineOffset: '-2px',
  },
  '.calendar-day[data-today=true] .calendar-day-header time': {
    fontWeight: 600,
    color: 'var(--affine-primary-color)',
  },
  '.calendar-day-header': {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  '.calendar-add': { padding: '0 5px' },
  '.calendar-row': {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    width: '100%',
    textAlign: 'left',
    marginBottom: '4px',
    overflow: 'hidden',
  },
  '.calendar-row[draggable=true]': {
    cursor: 'grab',
  },
  '.calendar-row[data-range-position=start]': {
    borderLeft: '3px solid var(--affine-primary-color)',
  },
  '.calendar-row[data-range-position=middle], .calendar-row[data-range-position=end]':
    {
      borderLeft: '3px solid var(--affine-border-color)',
      opacity: 0.92,
    },
  '.calendar-row-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
    width: '100%',
  },
  '.calendar-row-time': {
    flexShrink: 0,
    fontSize: '0.75em',
    color: 'var(--affine-text-secondary-color)',
    fontVariantNumeric: 'tabular-nums',
  },
  '.calendar-row-title': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  '.calendar-row-pills': {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    minWidth: 0,
  },
  '.calendar-row-pill': {
    fontSize: '0.75em',
    lineHeight: 1.2,
    padding: '1px 5px',
    borderRadius: '3px',
    background: 'var(--affine-background-primary-color)',
    border: '1px solid var(--affine-border-color)',
    color: 'var(--affine-text-secondary-color)',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.calendar-undated': { marginTop: '16px' },
  '.calendar-undated > div': {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '8px',
    marginTop: '8px',
  },
});

declare global {
  interface HTMLElementTagNameMap {
    'dv-calendar-view-ui': CalendarViewUI;
  }
}
