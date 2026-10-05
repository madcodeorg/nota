import { PresentationIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@nota/component';
import { EditorService } from '@nota/core/modules/editor';
import { useService } from '@nota/infra';

export const DetailPageHeaderPresentButton = () => {
  const editorService = useService(EditorService);

  return (
    <IconButton
      style={{ flexShrink: 0 }}
      size="24"
      onClick={() => editorService.editor.togglePresentation()}
    >
      <PresentationIcon />
    </IconButton>
  );
};
