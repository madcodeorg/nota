import { ColumnsBlockModel, MAX_COLUMNS } from '@blocksuite/affine-model';
import {
  ActionPlacement,
  type ToolbarAction,
  type ToolbarModuleConfig,
  ToolbarModuleExtension,
} from '@blocksuite/affine-shared/services';
import { appendColumn, unwrapColumns } from '@blocksuite/affine-shared/utils';
import { DeleteIcon, PlusIcon } from '@blocksuite/icons/lit';
import { BlockFlavourIdentifier } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';

import { columnsIcon } from '../icons.js';

const builtinToolbarConfig = {
  actions: [
    {
      id: 'a.add-column',
      label: 'Add column',
      tooltip: 'Add column',
      icon: PlusIcon(),
      when(ctx) {
        const model = ctx.getCurrentModelByType(ColumnsBlockModel);
        return !!model && model.children.length < MAX_COLUMNS;
      },
      run(ctx) {
        const model = ctx.getCurrentModelByType(ColumnsBlockModel);
        if (!model) return;
        ctx.store.captureSync();
        appendColumn(ctx.store, model);
      },
    },
    {
      id: 'b.remove-columns',
      label: 'Remove columns',
      tooltip: 'Remove columns, keep content',
      icon: columnsIcon(1),
      run(ctx) {
        const model = ctx.getCurrentModelByType(ColumnsBlockModel);
        if (!model) return;
        ctx.store.captureSync();
        unwrapColumns(ctx.store, model);
        ctx.select('note');
        ctx.reset();
      },
    },
    {
      placement: ActionPlacement.More,
      id: 'c.delete',
      label: 'Delete',
      icon: DeleteIcon(),
      variant: 'destructive',
      run(ctx) {
        const model = ctx.getCurrentModelByType(ColumnsBlockModel);
        if (!model) return;
        ctx.store.deleteBlock(model);
        ctx.select('note');
        ctx.reset();
      },
    },
  ] satisfies ToolbarAction[],
} as const satisfies ToolbarModuleConfig;

export const createBuiltinToolbarConfigExtension = (
  flavour: string
): ExtensionType[] => {
  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier(flavour),
      config: builtinToolbarConfig,
    }),
  ];
};
