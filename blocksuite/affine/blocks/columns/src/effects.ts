import { ColumnBlockComponent } from './column-block';
import { ColumnsBlockComponent } from './columns-block';

export function effects() {
  customElements.define('affine-columns', ColumnsBlockComponent);
  customElements.define('affine-column', ColumnBlockComponent);
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-columns': ColumnsBlockComponent;
    'affine-column': ColumnBlockComponent;
  }
}
