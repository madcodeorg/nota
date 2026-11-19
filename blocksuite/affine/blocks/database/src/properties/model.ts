import type { PropertyModel } from '@blocksuite/data-view';
import { propertyModelPresets } from '@blocksuite/data-view/property-pure-presets';

import {
  formulaPropertyModelConfig,
  relationPropertyModelConfig,
  rollupPropertyModelConfig,
} from './computed/define';
import { lastEditedTimePropertyModelConfig } from './last-edited-time/define';
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
    propertyModelPresets.statusPropertyModelConfig,
    propertyModelPresets.multiSelectPropertyModelConfig,
    linkPropertyModelConfig,
    richTextPropertyModelConfig,
    titlePropertyModelConfig,
    lastEditedTimePropertyModelConfig,
    relationPropertyModelConfig,
    formulaPropertyModelConfig,
    rollupPropertyModelConfig,
  ].map(v => [v.type, v as PropertyModel])
);
