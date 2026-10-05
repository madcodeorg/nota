import { css } from '@emotion/css';
import { computed, signal } from '@preact/signals-core';
import { html, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../core/utils/uni-component/uni-component.js';
import { DataViewUIBase } from '../../core/view/data-view-base.js';
import { CardViewUILogic } from '../card-view-ui.js';
import type { CalendarSingleView } from './calendar-view-manager.js';
import { calendarDayKey, calendarMonthDays } from './date-utils.js';

export class CalendarViewUILogic extends CardViewUILogic<CalendarSingleView> {
  private readonly localMonth$ = signal<Date | undefined>(undefined);
  month$ = computed(() => this.localMonth$.value ?? this.view.month$.value);

  monthSet = (month: Date) => {
    if (this.view.readonly$.value) this.localMonth$.value = month;
    else this.view.monthSet(month);
  };

  moveMonth = (offset: number) => {
    const month = this.month$.value;
    this.monthSet(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  };

  addAtDate = (date: Date) => {
    if (this.view.readonly$.value) return;
    const property = this.view.dateProperty$.value;
    if (!property) return;
    const id = this.view.rowAdd('end');
    property.valueSet(id, date.getTime());
    this.openRow(id);
  };

  renderer = createUniComponentFromWebComponent(CalendarViewUI);
}

export class CalendarViewUI extends DataViewUIBase<CalendarViewUILogic> {
  override connectedCallback(): void {
    super.connectedCallback();
    this.logic.ui$.value = this;
    this.classList.add(calendarStyle);
  }

  override disconnectedCallback(): void {
    if (this.logic.ui$.value === this) this.logic.ui$.value = undefined;
    super.disconnectedCallback();
  }

  private renderRow(rowId: string) {
    return html`<button
      class="calendar-row"
      data-row-id=${rowId}
      title=${this.logic.view.titleGet(rowId)}
      @click=${(event: MouseEvent) => {
        event.stopPropagation();
        this.logic.openRow(rowId);
      }}
    >
      ${this.logic.view.titleGet(rowId)}
    </button>`;
  }

  override render(): TemplateResult {
    const view = this.logic.view;
    const month = this.logic.month$.value;
    const { days, undated } = view.calendarRows$.value;
    const readonly = view.readonly$.value;
    const dateProperty = view.dateProperty$.value;
    const monthLabel = month.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    return html`
      ${renderUniLit(this.logic.headerWidget, { dataViewLogic: this.logic })}
      <div class="calendar-toolbar">
        <button
          aria-label="Previous month"
          @click=${() => this.logic.moveMonth(-1)}
        >
          ‹
        </button>
        <strong aria-live="polite">${monthLabel}</strong>
        <button aria-label="Next month" @click=${() => this.logic.moveMonth(1)}>
          ›
        </button>
        <button @click=${() => this.logic.monthSet(new Date())}>Today</button>
        <label>
          Date property
          <select
            aria-label="Calendar date property"
            .value=${dateProperty?.id ?? ''}
            ?disabled=${readonly || !dateProperty}
            @change=${(event: Event) =>
              view.dateColumnSet((event.target as HTMLSelectElement).value)}
          >
            ${!dateProperty
              ? html`<option value="">No date property</option>`
              : ''}
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
      ${!dateProperty
        ? html`<p>
            Add a Date property to schedule rows. All rows are available below.
          </p>`
        : ''}
      <div class="calendar-scroll">
        <div class="calendar-grid" role="group" aria-label=${monthLabel}>
          ${Array.from({ length: 7 }, (_, index) => {
            const day = new Date(2024, 0, 1 + index);
            return html`<span class="calendar-weekday"
              >${day.toLocaleDateString(undefined, { weekday: 'short' })}</span
            >`;
          })}
          ${repeat(
            calendarMonthDays(month),
            date => date.getTime(),
            date => {
              const key = calendarDayKey(date.getTime())!;
              const label = date.toLocaleDateString(undefined, {
                dateStyle: 'full',
              });
              return html`<section
                class="calendar-day"
                data-outside-month=${date.getMonth() !== month.getMonth()}
                aria-label=${label}
              >
                <div class="calendar-day-header">
                  <time datetime=${key}>${date.getDate()}</time>
                  ${!readonly && dateProperty
                    ? html`<button
                        class="calendar-add"
                        aria-label=${`Add row on ${label}`}
                        @click=${() => this.logic.addAtDate(date)}
                      >
                        +
                      </button>`
                    : ''}
                </div>
                ${repeat(
                  days.get(key) ?? [],
                  row => row.rowId,
                  row => this.renderRow(row.rowId)
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
            row => this.renderRow(row.rowId)
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
  },
  '.calendar-day[data-outside-month=true]': {
    background: 'var(--affine-background-secondary-color)',
  },
  '.calendar-day-header': {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  '.calendar-add': { padding: '0 5px' },
  '.calendar-row': {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    marginBottom: '4px',
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
