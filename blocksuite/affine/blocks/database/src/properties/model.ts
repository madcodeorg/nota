import type { PropertyModel } from '@blocksuite/data-view';
import { propertyModelPresets } from '@blocksuite/data-view/property-pure-presets';

import {
  formulaPropertyModelConfig,
  relationPropertyModelConfig,
  rollupPropertyModelConfig,
} from './computed/define';
import { linkPropertyModelConfig } from './link/define';
import { richTextPropertyModelConfig } from './rich-text/define';
import { titlePropertyModelConfig } from './title/define';

export const databaseBlockModels = Object.fromEntries(
  [
    propertyModelPresets.checkboxPropertyModelConfig,
    propertyModelPresets.datePropertyModelConfig,
    propertyModelPresets.numberPropertyModelConfig,
    propertyModelPresets.progressPropertyModelConfig,
    propertyModelPresets.selectPropertyModelConfig,
    propertyModelPresets.multiSelectPropertyModelConfig,
    linkPropertyModelConfig,
    richTextPropertyModelConfig,
    titlePropertyModelConfig,
    relationPropertyModelConfig,
    formulaPropertyModelConfig,
    rollupPropertyModelConfig,
  ].map(v => [v.type, v as PropertyModel])
);
