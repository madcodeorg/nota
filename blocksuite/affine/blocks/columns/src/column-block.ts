import { CaptionedBlockComponent } from '@blocksuite/affine-components/caption';
import type { ColumnBlockModel } from '@blocksuite/affine-model';
import { focusTextModel } from '@blocksuite/affine-rich-text';
import {
  isColumnModel,
  removeColumn,
  resizeColumnPair,
} from '@blocksuite/affine-shared/utils';
import { DeleteIcon } from '@blocksuite/icons/lit';
import { html, nothing } from 'lit';

import { columnBlockStyles, MIN_COLUMN_WIDTH } from './styles.js';

export class ColumnBlockComponent extends CaptionedBlockComponent<ColumnBlockModel> {
  static override styles = columnBlockStyles;

  private readonly _addParagraph = (event: MouseEvent) => {
    event.stopPropagation();
    if (this.store.readonly) return;
    const id = this.store.addBlock('affine:paragraph', {}, this.model);
    this.std.host.updateComplete
      .then(() => focusTextModel(this.std, id))
      .catch(console.error);
  };

  private readonly _removeColumn = (event: MouseEvent) => {
    event.stopPropagation();
    if (this.store.readonly) return;
    this.store.captureSync();
    removeColumn(this.store, this.model);
  };

  private readonly _onResizeStart = (event: PointerEvent) => {
    if (event.button !== 0 || this.store.readonly) return;
    const next = this.store.getNext(this.model);
    const nextView = next ? this.std.view.getBlock(next.id) : null;
    if (!isColumnModel(next) || !nextView) return;

    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.resizing = 'true';

    const startX = event.clientX;
    const ratios: [number, number] = [this.model.props.ratio, next.props.ratio];
    const widths: [number, number] = [
      this.getBoundingClientRect().width,
      nextView.getBoundingClientRect().width,
    ];
    // widths are measured on screen, so scale the minimum width the same way
    const scale = this.offsetWidth > 0 ? widths[0] / this.offsetWidth : 1;
    let result = ratios;

    const onMove = (e: PointerEvent) => {
      result = resizeColumnPair(
        ratios,
        widths,
        e.clientX - startX,
        MIN_COLUMN_WIDTH * scale
      );
      this.style.flexGrow = String(result[0]);
      nextView.style.flexGrow = String(result[1]);
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      delete handle.dataset.resizing;
      if (result[0] === ratios[0] && result[1] === ratios[1]) return;
      this.store.captureSync();
      this.store.transact(() => {
        this.store.updateBlock(this.model, { ratio: result[0] });
        this.store.updateBlock(next, { ratio: result[1] });
      });
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  private _renderPlaceholder() {
    const readonly = this.store.readonly;
    return html`<div
      class="affine-column-placeholder"
      contenteditable="false"
      @click=${this._addParagraph}
    >
      <span>${readonly ? 'Empty column' : 'Click to write'}</span>
      ${
        readonly
          ? nothing
          : html`<button
              class="affine-column-placeholder-remove"
              aria-label="Remove column"
              title="Remove column"
              @click=${this._removeColumn}
            >
              ${DeleteIcon()}
            </button>`
      }
    </div>`;
  }

  override renderBlock() {
    const ratio = this.model.props.ratio$.value;
    this.style.flexGrow = String(
      Number.isFinite(ratio) && ratio > 0 ? ratio : 1
    );
    const isEmpty = this.model.children.length === 0;

    return html`${
      isEmpty ? this._renderPlaceholder() : this.renderChildren(this.model)
    }
    ${
      this.store.readonly
        ? nothing
        : html`<div
            class="affine-column-resizer"
            contenteditable="false"
            @pointerdown=${this._onResizeStart}
          ></div>`
    }`;
  }
}
