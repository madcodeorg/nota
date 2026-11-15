import {
  createPopup,
  menu,
  popMenu,
  type PopupTarget,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import { rangeWrap } from '@blocksuite/affine-shared/utils';
import { IS_MOBILE } from '@blocksuite/global/env';
import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import {
  CloseIcon,
  DeleteIcon,
  MoreHorizontalIcon,
} from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { nanoid } from '@blocksuite/store';
import { autoPlacement, offset, shift } from '@floating-ui/dom';
import { computed, type ReadonlySignal, signal } from '@preact/signals-core';
import { cssVarV2 } from '@toeverything/theme/v2';
import { nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { html } from 'lit/static-html.js';

import type { SelectTag } from '../../logical/index.js';
import { stopPropagation } from '../../utils/event.js';
import { dragHandler } from '../../utils/wc-dnd/dnd-context.js';
import { defaultActivators } from '../../utils/wc-dnd/sensors/index.js';
import {
  createSortContext,
  sortable,
} from '../../utils/wc-dnd/sort/sort-context.js';
import { verticalListSortingStrategy } from '../../utils/wc-dnd/sort/strategies/index.js';
import { arrayMove } from '../../utils/wc-dnd/utils/array-move.js';
import { getTagColor, selectOptionColors } from './colors.js';
import {
  selectedStyle,
  selectOptionContentStyle,
  selectOptionDragHandlerStyle,
  selectOptionGroupTitleStyle,
  selectOptionIconStyle,
  selectOptionNewIconStyle,
  selectOptionsContainerStyle,
  selectOptionsTipsStyle,
  selectOptionStyle,
  tagContainerStyle,
  tagDeleteIconStyle,
  tagSelectContainerStyle,
  tagSelectInputContainerStyle,
  tagSelectInputStyle,
  tagTextStyle,
} from './styles-css.js';

type RenderOption = {
  value: string;
  id: string;
  color: string;
  group?: string;
  isCreate: boolean;
  select: () => void;
};
/** Fixed option groups, such as the To do / In progress / Complete groups of a status property. */
export type TagGroup = { id: string; name: string };
type GroupedTag = SelectTag & { group?: string };
export type TagManagerOptions = {
  mode?: 'single' | 'multi';
  value: ReadonlySignal<string[]>;
  onChange: (value: string[]) => void;
  options: ReadonlySignal<GroupedTag[]>;
  onOptionsChange: (options: GroupedTag[]) => void;
  groups?: readonly TagGroup[];
  onComplete?: () => void;
  initialDraftText?: string;
};

// parent elements that can consume tag draft
const TABLE_CELL_HOST_SELECTOR =
  'dv-table-view-cell-container, affine-database-virtual-cell-container';

export function consumeTagDraftFromTableCellHost(
  fromElement: Element
): string | undefined {
  const host = fromElement.closest(TABLE_CELL_HOST_SELECTOR) as any;
  return host?.consumeTagDraft?.();
}

export const groupTagOptions = <T extends GroupedTag>(
  options: T[],
  groups?: readonly TagGroup[]
): T[] => {
  if (!groups?.length) return options;
  return groups.flatMap(group =>
    options.filter(option => tagGroupOf(option, groups) === group.id)
  );
};

const tagGroupOf = (option: GroupedTag, groups: readonly TagGroup[]) =>
  groups.some(group => group.id === option.group)
    ? option.group
    : groups[0]?.id;

class TagManager {
  changeTag = (option: Partial<GroupedTag>) => {
    this.ops.onOptionsChange(
      this.ops.options.value.map(item => {
        if (item.id === option.id) {
          return {
            ...item,
            ...option,
          };
        }
        return item;
      })
    );
  };

  color$ = signal(getTagColor());

  createOption = () => {
    const value = this.text$.value.trim();
    if (value === '') return;
    const id = nanoid();
    const option: GroupedTag = {
      id: id,
      value: value,
      color: this.color$.value,
    };
    const group = this.ops.groups?.[0]?.id;
    if (group) {
      option.group = group;
    }
    this.ops.onOptionsChange([option, ...this.ops.options.value]);
    this.selectTag(id);
    this.text$.value = '';
    this.color$.value = getTagColor();
    if (this.isSingleMode) {
      this.ops.onComplete?.();
    }
  };

  deleteOption = (id: string) => {
    this.ops.onOptionsChange(
      this.ops.options.value.filter(item => item.id !== id)
    );
  };

  filteredOptions$ = computed(() => {
    let matched = false;
    const options: RenderOption[] = [];
    for (const option of this.orderedOptions$.value) {
      if (
        !this.text$.value ||
        option.value
          .toLocaleLowerCase()
          .includes(this.text$.value.toLocaleLowerCase())
      ) {
        options.push({
          ...option,
          group: this.groups ? tagGroupOf(option, this.groups) : undefined,
          isCreate: false,
          select: () => this.selectTag(option.id),
        });
      }
      if (option.value === this.text$.value) {
        matched = true;
      }
    }
    if (this.text$.value && !matched) {
      options.push({
        id: 'create',
        color: this.color$.value,
        value: this.text$.value,
        isCreate: true,
        select: this.createOption,
      });
    }
    return options;
  });

  orderedOptions$ = computed(() =>
    groupTagOptions(this.ops.options.value, this.ops.groups)
  );

  optionsMap$ = computed(() => {
    return new Map<string, SelectTag>(
      this.ops.options.value.map(v => [v.id, v])
    );
  });

  text$ = signal('');

  get groups() {
    return this.ops.groups;
  }

  get isSingleMode() {
    return this.ops.mode === 'single';
  }

  get options$() {
    return this.ops.options;
  }

  get value$() {
    return this.ops.value;
  }

  constructor(private readonly ops: TagManagerOptions) {}

  deleteTag(id: string) {
    this.ops.onChange(this.value$.value.filter(item => item !== id));
  }

  isSelected(id: string) {
    return this.value$.value.includes(id);
  }

  selectTag(id: string) {
    if (!this.isSingleMode && this.isSelected(id)) {
      return;
    }
    const newValue = this.isSingleMode ? [id] : [...this.value$.value, id];
    this.ops.onChange(newValue);
    this.text$.value = '';
    if (this.isSingleMode) {
      requestAnimationFrame(() => {
        this.ops.onComplete?.();
      });
    }
  }
}

export class MultiTagSelect extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  private readonly _clickItemOption = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    const option = this.options.value.find(v => v.id === id);
    if (!option) {
      return;
    }
    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          menu.input({
            initialValue: option.value,
            onChange: text => {
              this.tagManager.changeTag({
                id: option.id,
                value: text,
              });
            },
          }),
          menu.action({
            name: 'Delete',
            prefix: DeleteIcon(),
            class: {
              'delete-item': true,
            },
            select: () => {
              this.tagManager.deleteOption(id);
            },
          }),
          ...(this.groups
            ? [
                menu.group({
                  name: 'group',
                  items: [
                    () =>
                      html`<div class="${selectOptionGroupTitleStyle}">
                        Group
                      </div>`,
                    ...this.groups.map(group =>
                      menu.action({
                        name: group.name,
                        isSelected: this.groups
                          ? tagGroupOf(option, this.groups) === group.id
                          : false,
                        select: () => {
                          this.tagManager.changeTag({
                            id: option.id,
                            group: group.id,
                          });
                        },
                      })
                    ),
                  ],
                }),
              ]
            : []),
          menu.group({
            name: 'color',
            items: selectOptionColors.map(item => {
              const styles = styleMap({
                backgroundColor: item.color,
                borderRadius: '50%',
                width: '20px',
                height: '20px',
              });
              return menu.action({
                name: item.name,
                prefix: html` <div style=${styles}></div>`,
                isSelected: option.color === item.color,
                select: () => {
                  this.tagManager.changeTag({
                    id: option.id,
                    color: item.color,
                  });
                },
              });
            }),
          }),
        ],
      },
    });
  };

  private readonly _onInput = (event: KeyboardEvent) => {
    this.tagManager.text$.value = (event.target as HTMLInputElement).value;
  };

  private readonly _onInputKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    const inputValue = this.text.value.trim();
    if (event.key === 'Backspace' && inputValue === '') {
      const lastId = this.value.value[this.value.value.length - 1];
      if (lastId) {
        this.tagManager.deleteTag(lastId);
      }
    } else if (event.key === 'Enter' && !event.isComposing) {
      this.selectedTag$.value?.select();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.setSelectedOption(this.selectedIndex$.value - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.setSelectedOption(this.selectedIndex$.value + 1);
    } else if (event.key === 'Escape') {
      this.onComplete();
    }
  };

  private readonly tagManager = new TagManager(this);

  private readonly selectedTag$ = computed(() => {
    return this.tagManager.filteredOptions$.value[this.selectedIndex$.value];
  });

  sortContext = createSortContext({
    activators: defaultActivators,
    container: this,
    onDragEnd: evt => {
      const over = evt.over;
      const activeId = evt.active.id;
      if (over && over.id !== activeId) {
        const options = groupTagOptions(this.options.value, this.groups);
        const overOption = options.find(v => v.id === over.id);
        const overGroup =
          this.groups && overOption
            ? tagGroupOf(overOption, this.groups)
            : undefined;
        this.onOptionsChange(
          arrayMove(
            options,
            options.findIndex(v => v.id === activeId),
            options.findIndex(v => v.id === over.id)
          ).map(v =>
            overGroup && v.id === activeId ? { ...v, group: overGroup } : v
          )
        );
        this.requestUpdate();
        // const properties = this.filteredOptions$.value.map(v=>v.id);
        // const activeIndex = properties.findIndex(id => id === activeId);
        // const overIndex = properties.findIndex(id => id === over.id);
      }
    },
    modifiers: [
      ({ transform }) => {
        return {
          ...transform,
          x: 0,
        };
      },
    ],
    items: computed(() => {
      return this.tagManager.filteredOptions$.value.map(v => v.id);
    }),
    strategy: verticalListSortingStrategy,
  });

  private get text() {
    return this.tagManager.text$;
  }

  private renderInput() {
    return html`
      <div class="${tagSelectInputContainerStyle}">
        ${this.value.value.map(id => {
          const option = this.tagManager.optionsMap$.value.get(id);
          if (!option) {
            return null;
          }
          return this.renderTag(option.value, option.color, () =>
            this.tagManager.deleteTag(id)
          );
        })}
        <input
          class="${tagSelectInputStyle}"
          ${ref(this._selectInput)}
          placeholder="Type here..."
          .value="${this.text.value}"
          @input="${this._onInput}"
          @keydown="${this._onInputKeydown}"
          @pointerdown="${stopPropagation}"
        />
      </div>
    `;
  }

  private renderTag(name: string, color: string, onDelete?: () => void) {
    const style = styleMap({
      backgroundColor: color,
    });
    return html` <div class="${tagContainerStyle}" style=${style}>
      <div data-testid="tag-name" class="${tagTextStyle}">${name}</div>
      ${
        onDelete
          ? html` <div class="${tagDeleteIconStyle}" @click="${onDelete}">
              ${CloseIcon()}
            </div>`
          : nothing
      }
    </div>`;
  }

  private renderTags() {
    return html`
      <div
        style="height: 0.5px;background-color: ${cssVarV2(
          'layer/insideBorder/border'
        )};margin: 4px 0;"
      ></div>
      <div class="${selectOptionsTipsStyle}">
        ${
          this.groups
            ? 'Select an option or create one'
            : 'Select tag or create one'
        }
      </div>
      <div data-testid="tag-option-list" class="${selectOptionsContainerStyle}">
        ${
          this.groups
            ? this.renderGroupedOptions(this.groups)
            : repeat(
                this.tagManager.filteredOptions$.value,
                select => select.id,
                (select, index) => this.renderOption(select, index)
              )
        }
      </div>
    `;
  }

  private renderGroupedOptions(groups: readonly TagGroup[]) {
    const options = this.tagManager.filteredOptions$.value;
    const showEmptyGroups = !this.text.value;
    const entries = groups.flatMap(group => {
      const items = options.flatMap((option, index) =>
        !option.isCreate && option.group === group.id
          ? [{ key: option.id, render: () => this.renderOption(option, index) }]
          : []
      );
      if (!items.length && !showEmptyGroups) return [];
      return [
        {
          key: `group:${group.id}`,
          render: () =>
            html`<div
              class="${selectOptionGroupTitleStyle}"
              data-testid="tag-option-group"
            >
              ${group.name}
            </div>`,
        },
        ...items,
      ];
    });
    options.forEach((option, index) => {
      if (option.isCreate) {
        entries.push({
          key: option.id,
          render: () => this.renderOption(option, index),
        });
      }
    });
    return repeat(
      entries,
      entry => entry.key,
      entry => entry.render()
    );
  }

  private renderOption(select: RenderOption, index: number) {
    const isSelected = index === this.selectedIndex$.value;
    const mouseenter = () => {
      this.setSelectedOption(index);
    };
    const classes = classMap({
      [selectOptionStyle]: true,
      [selectedStyle]: isSelected,
    });
    const clickOption = (e: MouseEvent) => {
      e.stopPropagation();
      this._clickItemOption(e, select.id);
    };
    return html`
      <div
        ${!select.isCreate ? sortable(select.id) : nothing}
        class="${classes}"
        @mouseenter="${mouseenter}"
        @click="${select.select}"
      >
        <div class="${selectOptionContentStyle}">
          ${
            select.isCreate
              ? html` <div class="${selectOptionNewIconStyle}">Create</div>`
              : html`
                  <div
                    ${dragHandler(select.id)}
                    class="${selectOptionDragHandlerStyle}"
                  ></div>
                `
          }
          ${this.renderTag(select.value, select.color)}
        </div>
        ${
          !select.isCreate
            ? html` <div
                class="${selectOptionIconStyle}"
                @click="${clickOption}"
                data-testid="option-more"
              >
                ${MoreHorizontalIcon()}
              </div>`
            : null
        }
      </div>
    `;
  }

  private setSelectedOption(index: number) {
    this.selectedIndex$.value = rangeWrap(
      index,
      0,
      this.tagManager.filteredOptions$.value.length
    );
  }

  override connectedCallback() {
    super.connectedCallback();
    const draft = this.initialDraftText;
    if (draft != null && draft !== '') {
      this.tagManager.text$.value = draft;
      this.initialDraftText = undefined;
    }
  }

  protected override firstUpdated() {
    const disposables = this.disposables;
    this.classList.add(tagSelectContainerStyle);
    requestAnimationFrame(() => {
      this._selectInput.value?.focus();
    });
    disposables.addFromEvent(this, 'click', () => {
      this._selectInput.value?.focus();
    });

    disposables.addFromEvent(this._selectInput.value, 'copy', e => {
      e.stopPropagation();
    });
    disposables.addFromEvent(this._selectInput.value, 'cut', e => {
      e.stopPropagation();
    });
  }

  override render() {
    this.setSelectedOption(this.selectedIndex$.value);
    return html` ${this.renderInput()} ${this.renderTags()} `;
  }

  private readonly _selectInput = createRef<HTMLInputElement>();

  @property()
  accessor mode: 'multi' | 'single' = 'multi';

  @property({ attribute: false })
  accessor onChange!: (value: string[]) => void;

  @property({ attribute: false })
  accessor onComplete!: () => void;

  @property({ attribute: false })
  accessor onOptionsChange!: (options: GroupedTag[]) => void;

  @property({ attribute: false })
  accessor options!: ReadonlySignal<GroupedTag[]>;

  @property({ attribute: false })
  accessor groups: readonly TagGroup[] | undefined;

  private readonly selectedIndex$ = signal(0);

  @property({ attribute: false })
  accessor value!: ReadonlySignal<string[]>;

  @property({ attribute: false })
  accessor initialDraftText: string | undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-multi-tag-select': MultiTagSelect;
  }
}

const popMobileTagSelect = (target: PopupTarget, ops: TagSelectOptions) => {
  const tagManager = new TagManager(ops);
  if (ops.initialDraftText) {
    tagManager.text$.value = ops.initialDraftText;
  }
  const onInput = (e: InputEvent) => {
    tagManager.text$.value = (e.target as HTMLInputElement).value;
  };
  const onKeydown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const inputValue = (e.target as HTMLInputElement).value.trim();
    if (e.key === 'Backspace' && inputValue === '') {
      const values = tagManager.value$.value;
      const lastId = values[values.length - 1];
      if (lastId) {
        e.preventDefault();
        tagManager.deleteTag(lastId);
      }
    }
  };
  return popMenu(target, {
    options: {
      onClose: () => {
        ops.onComplete?.();
      },
      title: {
        text: ops.name,
      },
      items: [
        () => {
          return html`
            <div
              style="padding: 12px;border-radius: 12px;background-color: ${unsafeCSSVarV2(
                'layer/background/primary'
              )};display: flex;gap:8px 12px;"
            >
              ${ops.value.value.map(id => {
                const option = ops.options.value.find(v => v.id === id);
                if (!option) {
                  return null;
                }
                const style = styleMap({
                  backgroundColor: option.color,
                  width: 'max-content',
                });
                return html` <div class="${tagContainerStyle}" style=${style}>
                  <div class="${tagTextStyle}">${option.value}</div>
                  <div
                    class="${tagDeleteIconStyle}"
                    @click="${(e: MouseEvent) => {
                      e.stopPropagation();
                      tagManager.deleteTag(id);
                    }}"
                  >
                    ${CloseIcon()}
                  </div>
                </div>`;
              })}
              <input
                .value="${tagManager.text$.value}"
                @input="${onInput}"
                @keydown="${onKeydown}"
                placeholder="Type here..."
                type="text"
                style="outline: none;border: none;flex:1;min-width: 10px"
              />
            </div>
          `;
        },
        menu.group({
          items: [
            menu.dynamic(() => {
              const options = tagManager.filteredOptions$.value;
              return options.map(option =>
                menu.action({
                  name: option.value,
                  label: () => {
                    const style = styleMap({
                      backgroundColor: option.color,
                      width: 'max-content',
                    });
                    return html`
                      <div style="display: flex; align-items:center;">
                        ${
                          option.isCreate
                            ? html` <div style="margin-right: 8px;">
                                Create
                              </div>`
                            : ''
                        }
                        <div class="${tagContainerStyle}" style=${style}>
                          <div class="${tagTextStyle}">${option.value}</div>
                        </div>
                      </div>
                    `;
                  },
                  select: () => {
                    option.select();
                    return false;
                  },
                })
              );
            }),
          ],
        }),
      ],
    },
  });
};

export type TagSelectOptions = {
  name: string;
  minWidth?: number;
  container?: HTMLElement;
} & TagManagerOptions;
export const popTagSelect = (target: PopupTarget, ops: TagSelectOptions) => {
  if (IS_MOBILE) {
    const handler = popMobileTagSelect(target, ops);
    return () => {
      handler.close();
    };
  }
  const component = new MultiTagSelect();
  if (ops.mode) {
    component.mode = ops.mode;
  }
  const width = target.targetRect.getBoundingClientRect().width;
  component.style.width = `${Math.max(ops.minWidth ?? width, width)}px`;
  component.value = ops.value;
  component.onChange = ops.onChange;
  component.options = ops.options;
  component.groups = ops.groups;
  component.onOptionsChange = ops.onOptionsChange;
  component.initialDraftText = ops.initialDraftText;
  component.onComplete = () => {
    ops.onComplete?.();
    remove();
  };
  const remove = createPopup(target, component, {
    onClose: ops.onComplete,
    middleware: [
      autoPlacement({
        allowedPlacements: [
          'bottom-start',
          'bottom-end',
          'top-start',
          'top-end',
        ],
      }),
      offset({ mainAxis: -36 }),
      shift(),
    ],
    container: ops.container,
  });
  return remove;
};
