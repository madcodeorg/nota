import { focusTextModel } from '@blocksuite/affine-rich-text';
import {
  getClosestColumn,
  insertColumns,
  isColumnsModel,
  isInsideBlockByFlavour,
  unwrapColumns,
} from '@blocksuite/affine-shared/utils';
import {
  type SlashMenuActionItem,
  type SlashMenuConfig,
} from '@blocksuite/affine-widget-slash-menu';
import type { BlockStdScope } from '@blocksuite/std';
import type { BlockModel } from '@blocksuite/store';

import { columnsIcon } from '../icons.js';

/** The ancestor (or the block itself) that sits directly in a note. */
function getNoteLevelBlock(model: BlockModel) {
  let current: BlockModel | null = model;
  while (current?.parent) {
    if (current.parent.flavour === 'affine:note') return current;
    current = current.parent;
  }
  return null;
}

function canInsertColumns(model: BlockModel) {
  return (
    model.store.schema.flavourSchemaMap.has('affine:columns') &&
    !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text') &&
    !getClosestColumn(model) &&
    !!getNoteLevelBlock(model)
  );
}

function focusLater(std: BlockStdScope, id: string | undefined) {
  if (!id) return;
  std.host.updateComplete
    .then(() => focusTextModel(std, id))
    .catch(console.error);
}

function createColumnsItem(count: number): SlashMenuActionItem {
  return {
    name: `${count} Columns`,
    description: 'Side-by-side layout.',
    icon: columnsIcon(count),
    searchAlias: ['columns', 'column', 'layout', 'side by side', `${count}col`],
    group: `0_Basic@${8 + count}`,
    when: ({ model }) => canInsertColumns(model),
    action: ({ std, model }) => {
      const { store } = model;
      const anchor = getNoteLevelBlock(model);
      const note = anchor?.parent;
      if (!anchor || !note) return;

      // an empty line is replaced by the layout, like Notion does
      const replace =
        anchor === model &&
        model.flavour === 'affine:paragraph' &&
        model.text?.length === 0 &&
        model.children.length === 0;

      store.captureSync();
      const index = note.children.indexOf(anchor) + 1;
      const { paragraphIds } = insertColumns(store, note, index, count);
      if (replace) store.deleteBlock(model);
      focusLater(std, paragraphIds[0]);
    },
  };
}

export const columnsSlashMenuConfig: SlashMenuConfig = {
  items: [
    createColumnsItem(2),
    createColumnsItem(3),
    createColumnsItem(4),
    {
      name: 'Remove Columns',
      description: 'Keep content, drop columns.',
      icon: columnsIcon(1),
      searchAlias: ['uncolumn', 'un-column', 'unwrap columns', 'merge columns'],
      group: '0_Basic@13',
      when: ({ model }) => !!getClosestColumn(model),
      action: ({ std, model }) => {
        const columns = getClosestColumn(model)?.parent;
        if (!isColumnsModel(columns)) return;
        model.store.captureSync();
        unwrapColumns(model.store, columns);
        focusLater(std, model.text ? model.id : undefined);
      },
    },
  ],
};
