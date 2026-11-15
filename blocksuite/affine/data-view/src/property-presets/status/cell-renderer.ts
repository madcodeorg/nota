import { popupTargetFromElement } from '@blocksuite/affine-components/context-menu';
import { computed } from '@preact/signals-core';
import { html } from 'lit/static-html.js';

import {
  consumeTagDraftFromTableCellHost,
  popTagSelect,
} from '../../core/component/tags/multi-tag-select.js';
import { BaseCellRenderer } from '../../core/property/index.js';
import { createFromBaseCellRenderer } from '../../core/property/renderer.js';
import { createIcon } from '../../core/utils/uni-icon.js';
import { selectStyle } from '../select/cell-renderer-css.js';
import {
  statusGroupOf,
  statusGroups,
  type StatusOption,
  type StatusPropertyData,
  statusPropertyModelConfig,
} from './define.js';

export class StatusCell extends BaseCellRenderer<
  string,
  string,
  StatusPropertyData
> {
  closePopup?: () => void;
  private readonly popTagSelect = () => {
    const initialDraftText = consumeTagDraftFromTableCellHost(this);
    this.closePopup = popTagSelect(popupTargetFromElement(this), {
      name: this.cell.property.name$.value,
      mode: 'single',
      groups: statusGroups,
      options: this.options$,
      onOptionsChange: options => {
        this.property.dataUpdate(data => ({
          ...data,
          options: options.map((option): StatusOption => ({
            ...option,
            group: statusGroupOf(option),
          })),
        }));
      },
      value: this._value$,
      onChange: v => {
        this.valueSetImmediate(v[0]);
      },
      onComplete: this._editComplete,
      minWidth: 400,
      initialDraftText,
    });
  };

  _editComplete = () => {
    this.selectCurrentCell(false);
  };

  options$ = computed(() => {
    return this.property.data$.value.options ?? [];
  });

  _value$ = computed(() => {
    const value = this.value;
    return value ? [value] : [];
  });

  override afterEnterEditingMode() {
    if (!this.closePopup) {
      this.popTagSelect();
    }
  }

  override beforeExitEditingMode() {
    this.closePopup?.();
    this.closePopup = undefined;
  }

  override render() {
    return html`
      <div class="${selectStyle}">
        <affine-multi-tag-view
          .value="${this._value$.value}"
          .options="${this.options$.value}"
        ></affine-multi-tag-view>
      </div>
    `;
  }
}

export const statusPropertyConfig =
  statusPropertyModelConfig.createPropertyMeta({
    icon: createIcon('ChartPanelIcon'),
    cellRenderer: {
      view: createFromBaseCellRenderer(StatusCell),
    },
  });
