import { ListBlockModel } from '@blocksuite/affine-model';
import { textConversionConfigs } from '@blocksuite/affine-rich-text';
import { describe, expect, test, vi } from 'vitest';

import { splitListCommand } from '../commands/split-list.js';
import { LIST_MARKDOWN_PATTERN } from '../markdown.js';

function createFakeToggleModel(overrides: {
  id: string;
  collapsed: boolean;
  children?: unknown[];
  textLength?: number;
  splitResult?: string;
}) {
  const split = vi.fn().mockReturnValue(overrides.splitResult ?? '');
  const model = Object.create(ListBlockModel.prototype);
  Object.defineProperties(model, {
    id: { value: overrides.id, configurable: true },
    flavour: { value: 'affine:list', configurable: true },
    children: { value: overrides.children ?? [], configurable: true },
    props: {
      value: {
        type: 'toggle',
        collapsed: overrides.collapsed,
        order: null,
        text: { length: overrides.textLength ?? 5, split },
      },
      configurable: true,
    },
  });
  return { model, split };
}

describe('Toggle List block support', () => {
  test('registers Toggle List in textConversionConfigs for slash menu and Turn into', () => {
    const toggle = textConversionConfigs.find(
      item => item.flavour === 'affine:list' && item.type === 'toggle'
    );
    expect(toggle).toBeDefined();
    expect(toggle?.name).toBe('Toggle List');
    expect(toggle?.searchAlias).toContain('toggle');
  });

  test('matches ">> " markdown shortcut for toggle without colliding with "> " quote', () => {
    const toggleMatch = '>> '.match(LIST_MARKDOWN_PATTERN);
    expect(toggleMatch?.[7]).toBe('>>');
    expect('> '.match(LIST_MARKDOWN_PATTERN)).toBeNull();
    expect('- '.match(LIST_MARKDOWN_PATTERN)?.[3]).toBe('-');
  });

  test('creates a nested paragraph when pressing Enter inside an expanded toggle', () => {
    const addBlock = vi.fn().mockReturnValue('child-p');
    const captureSync = vi.fn();
    const { model: toggleModel, split } = createFakeToggleModel({
      id: 'toggle-1',
      collapsed: false,
      splitResult: 'rest',
    });
    const parentModel = {
      id: 'note-1',
      role: 'hub',
      children: [toggleModel],
    };
    const doc = {
      getBlock: (id: string) =>
        id === 'toggle-1' ? { model: toggleModel } : undefined,
      getParent: () => parentModel,
      captureSync,
      addBlock,
    };
    const next = vi.fn();
    splitListCommand(
      {
        blockId: 'toggle-1',
        inlineIndex: 5,
        std: {
          host: {
            store: doc,
            updateComplete: Promise.resolve(true),
          },
          event: { active: false },
          view: { getBlock: () => null },
          selection: { create: vi.fn(), setGroup: vi.fn() },
        },
      } as any,
      next
    );

    expect(captureSync).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledWith(5);
    expect(addBlock).toHaveBeenCalledWith(
      'affine:paragraph',
      { text: 'rest' },
      toggleModel,
      0
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('creates a sibling toggle when pressing Enter on a collapsed toggle', () => {
    const addBlock = vi.fn().mockReturnValue('toggle-2');
    const captureSync = vi.fn();
    const { model: toggleModel } = createFakeToggleModel({
      id: 'toggle-1',
      collapsed: true,
      children: [{ id: 'hidden-child' }],
      splitResult: '',
    });
    const parentModel = {
      id: 'note-1',
      role: 'hub',
      children: [toggleModel],
    };
    const doc = {
      getBlock: (id: string) =>
        id === 'toggle-1' ? { model: toggleModel } : undefined,
      getParent: () => parentModel,
      captureSync,
      addBlock,
    };
    const next = vi.fn();
    splitListCommand(
      {
        blockId: 'toggle-1',
        inlineIndex: 5,
        std: {
          host: {
            store: doc,
            updateComplete: Promise.resolve(true),
          },
          event: { active: false },
          view: { getBlock: () => null },
          selection: { create: vi.fn(), setGroup: vi.fn() },
        },
      } as any,
      next
    );

    expect(addBlock).toHaveBeenCalledWith(
      'affine:list',
      { type: 'toggle', text: '', order: null },
      parentModel,
      1
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
