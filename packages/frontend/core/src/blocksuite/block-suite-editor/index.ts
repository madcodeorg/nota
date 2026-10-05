import { registerAIEditorEffects } from '@nota/core/blocksuite/ai/effects/editor';
import { editorEffects } from '@nota/core/blocksuite/editors';

import { registerTemplates } from './register-templates';

editorEffects();
registerAIEditorEffects();
registerTemplates();

export * from './blocksuite-editor';
