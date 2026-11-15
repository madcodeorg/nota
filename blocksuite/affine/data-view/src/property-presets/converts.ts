import { clamp } from '@blocksuite/global/gfx';

import { createPropertyConvert } from '../core/index.js';
import { multiSelectPropertyModelConfig } from './multi-select/define.js';
import { numberPropertyModelConfig } from './number/define.js';
import { progressPropertyModelConfig } from './progress/define.js';
import { selectPropertyModelConfig } from './select/define.js';
import {
  statusPropertyModelConfig,
  toSelectOptions,
  toStatusOptions,
} from './status/define.js';

export const presetPropertyConverts = [
  createPropertyConvert(
    multiSelectPropertyModelConfig,
    selectPropertyModelConfig,
    (property, cells) => ({
      property,
      cells: cells.map(v => v?.[0]),
    })
  ),
  createPropertyConvert(
    numberPropertyModelConfig,
    progressPropertyModelConfig,
    (_property, cells) => ({
      property: {},
      cells: cells.map(v => clamp(v ?? 0, 0, 100)),
    })
  ),
  createPropertyConvert(
    progressPropertyModelConfig,
    numberPropertyModelConfig,
    (_property, cells) => ({
      property: {
        decimal: 0,
        format: 'number' as const,
      },
      cells: cells.map(v => v),
    })
  ),
  createPropertyConvert(
    selectPropertyModelConfig,
    multiSelectPropertyModelConfig,
    (property, cells) => ({
      property,
      cells: cells.map(v => (v ? [v] : undefined)),
    })
  ),
  createPropertyConvert(
    selectPropertyModelConfig,
    statusPropertyModelConfig,
    (property, cells) => ({
      property: { options: toStatusOptions(property.options) },
      cells,
    })
  ),
  createPropertyConvert(
    statusPropertyModelConfig,
    selectPropertyModelConfig,
    (property, cells) => ({
      property: { options: toSelectOptions(property.options) },
      cells,
    })
  ),
  createPropertyConvert(
    multiSelectPropertyModelConfig,
    statusPropertyModelConfig,
    (property, cells) => ({
      property: { options: toStatusOptions(property.options) },
      cells: cells.map(v => v?.[0]),
    })
  ),
  createPropertyConvert(
    statusPropertyModelConfig,
    multiSelectPropertyModelConfig,
    (property, cells) => ({
      property: {
        options: toSelectOptions(property.options),
      },
      cells: cells.map(v => (v ? [v] : undefined)),
    })
  ),
];
