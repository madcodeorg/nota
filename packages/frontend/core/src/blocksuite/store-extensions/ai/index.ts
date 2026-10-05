import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/affine/ext-loader';
import { AIChatBlockSchemaExtension } from '@nota/core/blocksuite/ai/blocks';
import { TranscriptionBlockSchemaExtension } from '@nota/core/blocksuite/ai/blocks/transcription-block/model';

export class AIStoreExtension extends StoreExtensionProvider {
  override name = 'affine-store-extensions';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(AIChatBlockSchemaExtension);
    context.register(TranscriptionBlockSchemaExtension);
  }
}
