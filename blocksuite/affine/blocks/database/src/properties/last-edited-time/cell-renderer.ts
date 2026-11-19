import type { BlockMeta } from '@blocksuite/affine-model';
import {
  BaseCellRenderer,
  createFromBaseCellRenderer,
  createIcon,
} from '@blocksuite/data-view';
import type { BlockModel } from '@blocksuite/store';
import { css } from '@emotion/css';
import { format } from 'date-fns/format';
import { html } from 'lit';

import type { DatabaseBlockDataSource } from '../../data-source.js';
import {
  lastEditedTimePropertyModelConfig,
  resolveLastEditedTimestamp,
} from './define.js';

const lastEditedTimeCellStyle = css({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: '100%',
});

const textStyle = css({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: '100%',
  fontSize: 'var(--data-view-cell-text-size)',
  lineHeight: 'var(--data-view-cell-text-line-height)',
  color: 'var(--affine-text-secondary-color)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export class LastEditedTimeCell extends BaseCellRenderer<
  number | null,
  number | null
> {
  private get dataSource() {
    return this.property?.view?.manager?.dataSource as
      DatabaseBlockDataSource | undefined;
  }

  private resolveTimestamp(): number | null {
    const doc = this.dataSource?.doc;
    const rowModel = (doc?.blocks?.value?.[this.cell.rowId]?.model ??
      doc?.getModelById?.(this.cell.rowId)) as
      BlockModel<BlockMeta> | undefined;

    return resolveLastEditedTimestamp({
      value: this.value,
      rowProps: rowModel?.props,
      docMeta: doc?.meta,
    });
  }

  renderContent() {
    const timestamp = this.resolveTimestamp();
    const formattedDate =
      timestamp != null ? format(timestamp, 'yyyy-MM-dd HH:mm:ss') : '';
    return html`<div class="${textStyle}" title="${formattedDate}">
      ${formattedDate}
    </div>`;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add(lastEditedTimeCellStyle);

    const doc = this.dataSource?.doc;
    if (doc?.workspace?.meta?.docMetaUpdated) {
      this._disposables.add(
        doc.workspace.meta.docMetaUpdated.subscribe(() => {
          this.requestUpdate();
        })
      );
    }
    if (doc?.slots?.blockUpdated) {
      this._disposables.add(
        doc.slots.blockUpdated.subscribe(payload => {
          if (payload.id === this.cell.rowId) {
            this.requestUpdate();
          }
        })
      );
    }
  }

  override beforeEnterEditMode() {
    return false;
  }

  override render() {
    return html`<div class="date-container">${this.renderContent()}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-database-last-edited-time-cell': LastEditedTimeCell;
  }
}

export const lastEditedTimeColumnConfig =
  lastEditedTimePropertyModelConfig.createPropertyMeta({
    icon: createIcon('HistoryIcon'),
    cellRenderer: {
      view: createFromBaseCellRenderer(LastEditedTimeCell),
    },
  });
