import '@blocksuite/affine-components/date-picker';

import {
  createPopup,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { IS_MOBILE } from '@blocksuite/global/env';
import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { flip, offset, shift } from '@floating-ui/dom';
import { computed, signal } from '@preact/signals-core';
import { format } from 'date-fns/format';
import { html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

import { BaseCellRenderer } from '../../core/property/index.js';
import { createFromBaseCellRenderer } from '../../core/property/renderer.js';
import { stopPropagation } from '../../core/utils/event.js';
import { createIcon } from '../../core/utils/uni-icon.js';
import {
  dateCalendarWrapStyle,
  dateCellStyle,
  dateClearButtonStyle,
  dateFooterRowStyle,
  dateInputLabelStyle,
  dateInputRowActiveStyle,
  dateInputRowStyle,
  dateInputsSectionStyle,
  dateNativeInputStyle,
  datePickerContainerStyle,
  datePopoverInlineStyle,
  datePopoverStyle,
  dateTimeInputStyle,
  dateToggleRowStyle,
  dateTogglesSectionStyle,
  dateToggleSwitchStyle,
  dateValueContainerStyle,
} from './cell-renderer-css.js';
import {
  datePropertyModelConfig,
  type DatePropertyValue,
  formatDatePropertyValue,
  getDateEnd,
  getDateStart,
  normalizeDateValue,
} from './define.js';

const toLocalMidnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

const applyDayPreservingTime = (
  pickedDay: Date,
  existing: Date | undefined,
  includeTime: boolean
) => {
  if (includeTime && existing) {
    return new Date(
      pickedDay.getFullYear(),
      pickedDay.getMonth(),
      pickedDay.getDate(),
      existing.getHours(),
      existing.getMinutes(),
      0,
      0
    );
  }
  return toLocalMidnight(pickedDay);
};

const parseNativeDateInput = (
  value: string,
  existing: Date | undefined,
  includeTime: boolean
): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const base = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(base.getTime()) ||
    base.getFullYear() !== year ||
    base.getMonth() !== month - 1 ||
    base.getDate() !== day
  ) {
    return undefined;
  }
  return applyDayPreservingTime(base, existing, includeTime);
};

const applyNativeTimeInput = (date: Date, timeValue: string): Date => {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match) return date;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return date;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0
  );
};

const formatInputDate = (date?: Date) =>
  date ? format(date, 'yyyy-MM-dd') : '';
const formatInputTime = (date?: Date) =>
  date ? format(date, 'HH:mm') : '00:00';

const areDateValuesEqual = (
  a: DatePropertyValue,
  b: DatePropertyValue
): boolean => {
  const na = normalizeDateValue(a);
  const nb = normalizeDateValue(b);
  if (na === nb) return true;
  if (
    na != null &&
    nb != null &&
    typeof na === 'object' &&
    typeof nb === 'object'
  ) {
    return (
      na.start === nb.start &&
      na.end === nb.end &&
      Boolean(na.includeTime) === Boolean(nb.includeTime)
    );
  }
  return false;
};

export class DateCellPopover extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  @property({ attribute: false })
  accessor initialValue: DatePropertyValue = null;

  @property({ type: Boolean })
  accessor inline = false;

  @property({ attribute: false })
  accessor onDraftChange: ((value: DatePropertyValue) => void) | undefined;

  @property({ attribute: false })
  accessor onClose: (() => void) | undefined;

  private readonly startDate$ = signal<Date | undefined>(undefined);
  private readonly endDate$ = signal<Date | undefined>(undefined);
  private readonly hasEndDate$ = signal(false);
  private readonly includeTime$ = signal(false);
  private readonly activeField$ = signal<'start' | 'end'>('start');

  override connectedCallback() {
    super.connectedCallback();
    const normalized = normalizeDateValue(this.initialValue);
    const start = getDateStart(normalized);
    const end = getDateEnd(normalized);
    const includeTime =
      typeof normalized === 'object' && normalized?.includeTime === true;

    this.startDate$.value = start != null ? new Date(start) : undefined;
    this.endDate$.value = end != null ? new Date(end) : undefined;
    this.hasEndDate$.value = end != null;
    this.includeTime$.value = includeTime;
    this.activeField$.value = 'start';
  }

  protected override firstUpdated() {
    this.classList.add(this.inline ? datePopoverInlineStyle : datePopoverStyle);
  }

  private emitDraft() {
    const start = this.startDate$.value;
    if (!start) {
      this.onDraftChange?.(null);
      return;
    }
    const hasEnd = this.hasEndDate$.value;
    const end = hasEnd ? this.endDate$.value : undefined;
    const includeTime = this.includeTime$.value;
    const next = normalizeDateValue({
      start: start.getTime(),
      ...(end ? { end: end.getTime() } : {}),
      ...(includeTime ? { includeTime: true } : {}),
    });
    this.onDraftChange?.(next);
  }

  private setStartDate(nextStart: Date) {
    this.startDate$.value = nextStart;
    if (
      this.hasEndDate$.value &&
      this.endDate$.value &&
      this.endDate$.value.getTime() < nextStart.getTime()
    ) {
      this.endDate$.value = new Date(nextStart.getTime());
    }
    this.emitDraft();
  }

  private setEndDate(nextEnd: Date) {
    if (!this.startDate$.value) {
      this.startDate$.value = new Date(nextEnd.getTime());
      this.endDate$.value = new Date(nextEnd.getTime());
    } else if (nextEnd.getTime() < this.startDate$.value.getTime()) {
      const prevStart = this.startDate$.value;
      this.startDate$.value = nextEnd;
      this.endDate$.value = prevStart;
    } else {
      this.endDate$.value = nextEnd;
    }
    this.emitDraft();
  }

  private readonly _onCalendarPick = (picked: Date) => {
    const includeTime = this.includeTime$.value;
    if (this.hasEndDate$.value && this.activeField$.value === 'end') {
      const nextEnd = applyDayPreservingTime(
        picked,
        this.endDate$.value ?? this.startDate$.value,
        includeTime
      );
      this.setEndDate(nextEnd);
    } else {
      const nextStart = applyDayPreservingTime(
        picked,
        this.startDate$.value,
        includeTime
      );
      this.setStartDate(nextStart);
    }
  };

  private readonly _toggleEndDate = (enabled: boolean) => {
    this.hasEndDate$.value = enabled;
    if (enabled) {
      if (!this.startDate$.value) {
        const now = new Date();
        this.startDate$.value = this.includeTime$.value
          ? new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              now.getHours(),
              now.getMinutes(),
              0,
              0
            )
          : toLocalMidnight(now);
      }
      this.endDate$.value = new Date(this.startDate$.value.getTime());
      this.activeField$.value = 'end';
    } else {
      this.endDate$.value = undefined;
      this.activeField$.value = 'start';
    }
    this.emitDraft();
  };

  private readonly _toggleIncludeTime = (enabled: boolean) => {
    this.includeTime$.value = enabled;
    if (enabled) {
      if (!this.startDate$.value) {
        const now = new Date();
        this.startDate$.value = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours(),
          now.getMinutes(),
          0,
          0
        );
      }
      if (
        this.hasEndDate$.value &&
        !this.endDate$.value &&
        this.startDate$.value
      ) {
        this.endDate$.value = new Date(this.startDate$.value.getTime());
      }
    } else {
      if (this.startDate$.value) {
        this.startDate$.value = toLocalMidnight(this.startDate$.value);
      }
      if (this.endDate$.value) {
        this.endDate$.value = toLocalMidnight(this.endDate$.value);
      }
    }
    this.emitDraft();
  };

  private readonly _clearDate = () => {
    this.startDate$.value = undefined;
    this.endDate$.value = undefined;
    this.hasEndDate$.value = false;
    this.includeTime$.value = false;
    this.activeField$.value = 'start';
    this.onDraftChange?.(null);
    this.onClose?.();
  };

  override render() {
    const start = this.startDate$.value;
    const end = this.endDate$.value;
    const hasEnd = this.hasEndDate$.value;
    const includeTime = this.includeTime$.value;
    const activeField = this.activeField$.value;

    const pickerTimestamp =
      hasEnd && activeField === 'end'
        ? (end?.getTime() ?? start?.getTime() ?? Date.now())
        : (start?.getTime() ?? Date.now());

    const startRowClasses = classMap({
      [dateInputRowStyle]: true,
      [dateInputRowActiveStyle]: !hasEnd || activeField === 'start',
    });

    const endRowClasses = classMap({
      [dateInputRowStyle]: true,
      [dateInputRowActiveStyle]: hasEnd && activeField === 'end',
    });

    return html`
      <div
        class="${dateInputsSectionStyle}"
        @pointerdown=${stopPropagation}
        @keydown=${(e: KeyboardEvent) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            this.onClose?.();
          }
        }}
      >
        <div
          class="${startRowClasses}"
          @click=${() => {
            this.activeField$.value = 'start';
          }}
        >
          ${
            hasEnd
              ? html`<span class="${dateInputLabelStyle}">Start</span>`
              : nothing
          }
          <input
            type="date"
            aria-label="Start date"
            class="${dateNativeInputStyle}"
            .value=${formatInputDate(start)}
            @focus=${() => {
              this.activeField$.value = 'start';
            }}
            @change=${(e: Event) => {
              const parsed = parseNativeDateInput(
                (e.target as HTMLInputElement).value,
                this.startDate$.value,
                this.includeTime$.value
              );
              if (parsed) {
                this.setStartDate(parsed);
              }
            }}
          />
          ${
            includeTime
              ? html`
                  <input
                    type="time"
                    aria-label="Start time"
                    class="${dateTimeInputStyle}"
                    .value=${formatInputTime(start)}
                    @focus=${() => {
                      this.activeField$.value = 'start';
                    }}
                    @change=${(e: Event) => {
                      const base =
                        this.startDate$.value ?? toLocalMidnight(new Date());
                      this.setStartDate(
                        applyNativeTimeInput(
                          base,
                          (e.target as HTMLInputElement).value
                        )
                      );
                    }}
                  />
                `
              : nothing
          }
        </div>
        ${
          hasEnd
            ? html`
                <div
                  class="${endRowClasses}"
                  @click=${() => {
                    this.activeField$.value = 'end';
                  }}
                >
                  <span class="${dateInputLabelStyle}">End</span>
                  <input
                    type="date"
                    aria-label="End date"
                    class="${dateNativeInputStyle}"
                    .value=${formatInputDate(end)}
                    @focus=${() => {
                      this.activeField$.value = 'end';
                    }}
                    @change=${(e: Event) => {
                      const parsed = parseNativeDateInput(
                        (e.target as HTMLInputElement).value,
                        this.endDate$.value ?? this.startDate$.value,
                        this.includeTime$.value
                      );
                      if (parsed) {
                        this.setEndDate(parsed);
                      }
                    }}
                  />
                  ${
                    includeTime
                      ? html`
                          <input
                            type="time"
                            aria-label="End time"
                            class="${dateTimeInputStyle}"
                            .value=${formatInputTime(end ?? start)}
                            @focus=${() => {
                              this.activeField$.value = 'end';
                            }}
                            @change=${(e: Event) => {
                              const base =
                                this.endDate$.value ??
                                this.startDate$.value ??
                                toLocalMidnight(new Date());
                              this.setEndDate(
                                applyNativeTimeInput(
                                  base,
                                  (e.target as HTMLInputElement).value
                                )
                              );
                            }}
                          />
                        `
                      : nothing
                  }
                </div>
              `
            : nothing
        }
      </div>

      <div class="${dateCalendarWrapStyle}" @pointerdown=${stopPropagation}>
        <date-picker
          .padding=${this.inline ? 0 : 8}
          .value=${pickerTimestamp}
          .onChange=${this._onCalendarPick}
          .onEscape=${() => this.onClose?.()}
        ></date-picker>
      </div>

      <div class="${dateTogglesSectionStyle}" @pointerdown=${stopPropagation}>
        <label class="${dateToggleRowStyle}">
          <span>End date</span>
          <input
            type="checkbox"
            aria-label="End date"
            class="${dateToggleSwitchStyle}"
            .checked=${hasEnd}
            @change=${(e: Event) =>
              this._toggleEndDate((e.target as HTMLInputElement).checked)}
          />
        </label>
        <label class="${dateToggleRowStyle}">
          <span>Include time</span>
          <input
            type="checkbox"
            aria-label="Include time"
            class="${dateToggleSwitchStyle}"
            .checked=${includeTime}
            @change=${(e: Event) =>
              this._toggleIncludeTime((e.target as HTMLInputElement).checked)}
          />
        </label>
      </div>

      <div class="${dateFooterRowStyle}" @pointerdown=${stopPropagation}>
        <button
          type="button"
          class="${dateClearButtonStyle}"
          @click=${this._clearDate}
        >
          Clear
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-database-date-popover': DateCellPopover;
  }
}

export class DateCell extends BaseCellRenderer<
  DatePropertyValue,
  number | null
> {
  private closePopup?: () => void;

  draftValue$ = signal<DatePropertyValue | undefined>(undefined);

  private readonly openDatePicker = () => {
    if (this.closePopup) return;

    const initialValue = normalizeDateValue(this.value);
    this.draftValue$.value = initialValue;

    let closed = false;
    const handleClose = () => {
      if (closed) return;
      closed = true;
      this.closePopup = undefined;
      this.selectCurrentCell(false);
    };

    if (IS_MOBILE) {
      const handler = popMenu(popupTargetFromElement(this), {
        options: {
          title: {
            text: this.property.name$.value,
          },
          onClose: handleClose,
          items: [
            () =>
              html`<div class="${dateValueContainerStyle}">
                ${this.formattedValue$.value}
              </div>`,
            () => {
              const popover = new DateCellPopover();
              popover.inline = true;
              popover.initialValue = initialValue;
              popover.onDraftChange = next => {
                this.draftValue$.value = next;
              };
              popover.onClose = () => {
                handler.close();
              };
              return html`<div class="${datePickerContainerStyle}">
                ${popover}
              </div>`;
            },
          ],
        },
      });
      this.closePopup = () => handler.close();
    } else {
      const popover = new DateCellPopover();
      popover.initialValue = initialValue;
      popover.onDraftChange = next => {
        this.draftValue$.value = next;
      };
      const remove = createPopup(popupTargetFromElement(this), popover, {
        placement: 'bottom-start',
        middleware: [offset(6), flip(), shift({ crossAxis: true })],
        onClose: handleClose,
      });
      popover.onClose = () => {
        remove();
      };
      this.closePopup = remove;
    }
  };

  private readonly updateValue = () => {
    if (this.draftValue$.value === undefined) {
      return;
    }

    const nextValue = normalizeDateValue(this.draftValue$.value);
    const currentValue = normalizeDateValue(this.value);
    this.draftValue$.value = undefined;

    if (areDateValuesEqual(nextValue, currentValue)) {
      return;
    }

    this.valueSetNextTick(nextValue);
  };

  formattedValue$ = computed(() => {
    const activeValue =
      this.draftValue$.value !== undefined
        ? this.draftValue$.value
        : normalizeDateValue(this.value);
    return formatDatePropertyValue(activeValue, 'yyyy/MM/dd');
  });

  override afterEnterEditingMode() {
    this.openDatePicker();
  }

  override beforeExitEditingMode() {
    this.updateValue();
    const close = this.closePopup;
    this.closePopup = undefined;
    close?.();
  }

  override render() {
    return html`<div class="${dateCellStyle} date">
      ${this.formattedValue$.value}
    </div>`;
  }
}

export const datePropertyConfig = datePropertyModelConfig.createPropertyMeta({
  icon: createIcon('DateTimeIcon'),
  cellRenderer: {
    view: createFromBaseCellRenderer(DateCell),
  },
});
