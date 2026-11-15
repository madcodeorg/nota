import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import { SlashMenuConfigExtension } from '@blocksuite/affine-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { columnsSlashMenuConfig } from './configs/slash-menu';
import { createBuiltinToolbarConfigExtension } from './configs/toolbar';
import { effects } from './effects';

export class ColumnsViewExtension extends ViewExtensionProvider {
  override name = 'affine-columns-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension('affine:columns'),
      FlavourExtension('affine:column'),
      BlockViewExtension('affine:columns', literal`affine-columns`),
      BlockViewExtension('affine:column', literal`affine-column`),
      SlashMenuConfigExtension('affine:columns', columnsSlashMenuConfig),
      ...createBuiltinToolbarConfigExtension('affine:columns'),
    ]);
  }
}
