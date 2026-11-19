import { toast } from '@blocksuite/affine/components/toast';
import { NoteDisplayMode } from '@blocksuite/affine/model';
import { REFERENCE_NODE } from '@blocksuite/affine/shared/consts';
import { SidebarExtensionIdentifier } from '@blocksuite/affine/shared/services';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { isInsideBlockByFlavour } from '@blocksuite/affine/shared/utils';
import type { BlockStdScope } from '@blocksuite/affine/std';
import { type BlockModel, Text } from '@blocksuite/affine/store';
import {
  SlashMenuConfigExtension,
  type SlashMenuItem,
} from '@blocksuite/affine/widgets/slash-menu';
import { TocIcon } from '@blocksuite/icons/lit';

export type TocHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TocHeadingBlockLike {
  id: string;
  flavour: string;
  props?: {
    type?: string;
    // eslint-disable-next-line rxjs/finnish
    type$?: { value?: string };
    displayMode?: string;
    // eslint-disable-next-line rxjs/finnish
    displayMode$?: { value?: string };
  };
  text?: { toString(): string } | string | null;
  children?: readonly TocHeadingBlockLike[];
}

export interface TocHeadingEntry {
  id: string;
  level: TocHeadingLevel;
  indent: number;
  text: string;
}

const HEADING_TYPE_PATTERN = /^h([1-6])$/;

export function extractTocHeadings(
  root: TocHeadingBlockLike | null | undefined,
  options?: { excludeBlockId?: string }
): TocHeadingEntry[] {
  if (!root) {
    return [];
  }

  const raw: Array<{ id: string; level: TocHeadingLevel; text: string }> = [];
  const excludeBlockId = options?.excludeBlockId;

  const visit = (block: TocHeadingBlockLike) => {
    if (block.flavour === 'affine:surface') {
      return;
    }

    if (block.flavour === 'affine:note') {
      const displayMode =
        block.props?.displayMode$?.value ?? block.props?.displayMode;
      if (displayMode === NoteDisplayMode.EdgelessOnly) {
        return;
      }
    }

    if (block.id !== excludeBlockId && block.flavour === 'affine:paragraph') {
      const paragraphType = block.props?.type$?.value ?? block.props?.type;
      const match =
        typeof paragraphType === 'string'
          ? HEADING_TYPE_PATTERN.exec(paragraphType)
          : null;
      if (match) {
        const rawText =
          typeof block.text === 'string'
            ? block.text
            : (block.text?.toString() ?? '');
        const text = rawText.trim();
        if (text.length > 0) {
          raw.push({
            id: block.id,
            level: Number(match[1]) as TocHeadingLevel,
            text,
          });
        }
      }
    }

    for (const child of block.children ?? []) {
      visit(child);
    }
  };

  visit(root);

  if (raw.length === 0) {
    return [];
  }

  const minLevel = Math.min(...raw.map(item => item.level));
  return raw.map(item => ({
    ...item,
    indent: item.level - minLevel,
  }));
}

export function insertTocBlocks(
  std: Pick<BlockStdScope, 'store'>,
  model: BlockModel,
  headings: readonly TocHeadingEntry[]
): boolean {
  const store = std.store;
  const parent = store.getParent(model);
  if (!parent) {
    return false;
  }

  const modelIndex = parent.children.indexOf(model);
  if (modelIndex === -1) {
    return false;
  }

  const shouldDeleteTriggerBlock =
    model.flavour === 'affine:paragraph' &&
    (!model.text || model.text.length === 0) &&
    model.children.length === 0;

  store.transact(() => {
    let insertIndex = modelIndex + 1;

    store.addBlock(
      'affine:paragraph',
      {
        type: 'text',
        text: new Text([
          {
            insert: 'Table of Contents',
            attributes: { bold: true },
          },
        ]),
      },
      parent,
      insertIndex++
    );

    const stack: Array<{ level: TocHeadingLevel; blockId: string }> = [];

    for (const heading of headings) {
      while (
        stack.length > 0 &&
        stack[stack.length - 1].level >= heading.level
      ) {
        stack.pop();
      }

      const listText = new Text<AffineTextAttributes>([
        {
          insert: REFERENCE_NODE,
          attributes: {
            reference: {
              type: 'LinkedPage',
              pageId: store.id,
              title: heading.text,
              params: {
                mode: 'page',
                blockIds: [heading.id],
              },
            },
          },
        },
      ]);

      const listParent =
        stack.length > 0 ? stack[stack.length - 1].blockId : parent;
      const listIndex = stack.length > 0 ? undefined : insertIndex++;
      const blockId = store.addBlock(
        'affine:list',
        {
          type: 'bulleted',
          text: listText,
        },
        listParent,
        listIndex
      );

      stack.push({ level: heading.level, blockId });
    }

    if (shouldDeleteTriggerBlock) {
      store.deleteBlock(model);
    }
  });

  return true;
}

export function createTocSlashMenuExtension() {
  const items: SlashMenuItem[] = [
    {
      name: 'Table of Contents',
      description: 'Insert a table of contents from page headings.',
      searchAlias: ['toc', 'outline', 'contents', 'headings'],
      icon: TocIcon(),
      group: '0_Basic@10',
      when: ({ model }) =>
        model.store.schema.flavourSchemaMap.has('affine:list') &&
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
      action: ({ std, model }) => {
        const headings = extractTocHeadings(
          std.store.root as TocHeadingBlockLike | null,
          { excludeBlockId: model.id }
        );

        if (headings.length === 0) {
          toast(
            std.host,
            'No headings found. Add headings to generate a table of contents.'
          );
          std.getOptional(SidebarExtensionIdentifier)?.open('outline');
          return;
        }

        insertTocBlocks(std, model, headings);
      },
    },
  ];

  return SlashMenuConfigExtension('nota:toc', {
    items,
  });
}
