import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import {
  ColumnBlockSchemaExtension,
  ColumnsBlockSchemaExtension,
} from '@blocksuite/affine-model';

import {
  ColumnBlockHtmlAdapterExtension,
  ColumnsBlockHtmlAdapterExtension,
} from './adapters/html';

export class ColumnsStoreExtension extends StoreExtensionProvider {
  override name = 'affine-columns-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([
      ColumnsBlockSchemaExtension,
      ColumnBlockSchemaExtension,
      ColumnsBlockHtmlAdapterExtension,
      ColumnBlockHtmlAdapterExtension,
    ]);
  }
}
