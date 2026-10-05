import {
  EdgelessTemplatePanel,
  type TemplateManager,
} from '@blocksuite/affine/gfx/template';
import { builtInTemplates as builtInEdgelessTemplates } from '@nota/templates/edgeless';
import { builtInTemplates as builtInStickersTemplates } from '@nota/templates/stickers';

export function registerTemplates() {
  EdgelessTemplatePanel.templates.extend(
    builtInStickersTemplates as TemplateManager
  );
  EdgelessTemplatePanel.templates.extend(
    builtInEdgelessTemplates as TemplateManager
  );
}
