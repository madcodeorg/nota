import { ImageBlockComponent } from '@blocksuite/affine/blocks/image';
import { toast } from '@blocksuite/affine/components/toast';
import { AttachmentBlockModel } from '@blocksuite/affine/model';
import type { ToolbarContext } from '@blocksuite/affine/shared/services';
import { type BlockModel, Text } from '@blocksuite/affine/store';
import { apis } from '@nota/electron-api';

type TextSource = {
  model: BlockModel;
  sourceId: string;
  kind: 'image' | 'pdf';
};

const running = new Set<string>();

export function getTextSource(ctx: ToolbarContext): TextSource | null {
  const image = ctx.getCurrentBlockByType(ImageBlockComponent)?.model;
  if (image?.props.sourceId) {
    return { model: image, sourceId: image.props.sourceId, kind: 'image' };
  }
  const attachment = ctx.getCurrentModelByType(AttachmentBlockModel);
  if (
    attachment?.props.sourceId &&
    attachment.props.type === 'application/pdf'
  ) {
    return {
      model: attachment,
      sourceId: attachment.props.sourceId,
      kind: 'pdf',
    };
  }
  return null;
}

export function canExtractText(ctx: ToolbarContext) {
  return (
    BUILD_CONFIG.isElectron &&
    environment.isMacOs &&
    ctx.isPageMode &&
    !ctx.store.readonly &&
    !!apis?.recording.recognizeText &&
    !!getTextSource(ctx)
  );
}

export async function extractText(ctx: ToolbarContext) {
  const source = getTextSource(ctx);
  const recognizeText = apis?.recording.recognizeText;
  if (!source || !recognizeText || running.has(source.model.id)) return;
  const { host, store } = ctx.std;
  running.add(source.model.id);
  try {
    const blob = await store.blobSync.get(source.sourceId);
    if (!blob) throw new Error('The file is not available yet.');
    toast(host, 'Recognizing text…');
    const text = await recognizeText({
      data: new Uint8Array(await blob.arrayBuffer()),
      kind: source.kind,
    });
    const paragraphs = text
      .split(/\n{2,}/)
      .map(part => part.trim())
      .filter(Boolean);
    if (!paragraphs.length) {
      toast(host, 'No text found');
      return;
    }
    store.addSiblingBlocks(
      source.model,
      paragraphs.map(part => ({
        flavour: 'affine:paragraph',
        text: new Text(part),
      }))
    );
    toast(host, 'Text added below');
  } catch (error) {
    console.error(error);
    toast(host, 'Could not recognize text in this file');
  } finally {
    running.delete(source.model.id);
  }
}
