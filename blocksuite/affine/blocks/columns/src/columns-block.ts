import { CaptionedBlockComponent } from '@blocksuite/affine-components/caption';
import type { ColumnsBlockModel } from '@blocksuite/affine-model';
import { html } from 'lit';

import { columnsBlockStyles } from './styles.js';

export class ColumnsBlockComponent extends CaptionedBlockComponent<ColumnsBlockModel> {
  static override styles = columnsBlockStyles;

  override renderBlock() {
    return html`<div class="affine-columns-container">
      ${this.renderChildren(this.model)}
    </div>`;
  }

  override accessor useZeroWidth = true;
}
