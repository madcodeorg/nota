import {
  ColumnBlockSchema,
  ColumnsBlockSchema,
} from '@blocksuite/affine-model';
import {
  BlockHtmlAdapterExtension,
  type BlockHtmlAdapterMatcher,
} from '@blocksuite/affine-shared/adapters';

export const columnsBlockHtmlAdapterMatcher: BlockHtmlAdapterMatcher = {
  flavour: ColumnsBlockSchema.model.flavour,
  toMatch: () => false,
  fromMatch: o => o.node.flavour === ColumnsBlockSchema.model.flavour,
  toBlockSnapshot: {},
  fromBlockSnapshot: {
    enter: (_, context) => {
      context.walkerContext.openNode(
        {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['affine-columns-block-container'],
            style: 'display: flex; flex-wrap: wrap; gap: 24px;',
          },
          children: [],
        },
        'children'
      );
    },
    leave: (_, context) => {
      context.walkerContext.closeNode();
    },
  },
};

export const columnBlockHtmlAdapterMatcher: BlockHtmlAdapterMatcher = {
  flavour: ColumnBlockSchema.model.flavour,
  toMatch: () => false,
  fromMatch: o => o.node.flavour === ColumnBlockSchema.model.flavour,
  toBlockSnapshot: {},
  fromBlockSnapshot: {
    enter: (o, context) => {
      const ratio = Number(o.node.props.ratio);
      const grow = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      context.walkerContext.openNode(
        {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['affine-column-block-container'],
            style: `flex: ${grow} 1 0; min-width: 160px;`,
          },
          children: [],
        },
        'children'
      );
    },
    leave: (_, context) => {
      context.walkerContext.closeNode();
    },
  },
};

export const ColumnsBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(
  columnsBlockHtmlAdapterMatcher
);

export const ColumnBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(
  columnBlockHtmlAdapterMatcher
);
