import {
  menu,
  type MenuConfig,
} from '@blocksuite/affine-components/context-menu';
import { RefNodeSlotsProvider } from '@blocksuite/affine-inline-reference';
import {
  BaseCellRenderer,
  createFromBaseCellRenderer,
  createIcon,
  type Property,
} from '@blocksuite/data-view';
import { computed } from '@preact/signals-core';
import { html } from 'lit';

import { EditorHostKey } from '../../context/host-context.js';
import type { DatabaseBlockDataSource } from '../../data-source.js';
import {
  formulaPropertyModelConfig,
  relationDataSchema,
  relationPropertyModelConfig,
  rollupPropertyModelConfig,
} from './define.js';
import { computedText, isComputedError } from './evaluate.js';
import {
  formatFormulaPreviewValue,
  FORMULA_RESULT_TYPES,
  popFormulaEditor,
} from './formula-editor.js';

const sourceFor = (property: Property) =>
  property.view.manager.dataSource as DatabaseBlockDataSource;
const message =
  (text: string): MenuConfig =>
  () =>
    html`<p
      style="margin:8px;font-size:12px;max-width:280px;white-space:normal;color:var(--affine-text-secondary-color)"
    >
      ${text}
    </p>`;

function relationConfig(property: Property): MenuConfig[] {
  const source = sourceFor(property);
  let discoveryTriggered = false;
  const reciprocalChecked$ = computed(() =>
    Boolean(property.data$.value.reciprocal)
  );

  return [
    menu.subMenu({
      name: 'Related database',
      options: {
        items: [
          menu.dynamic(() => {
            if (
              !discoveryTriggered &&
              source.hasUnloadedRelationDocs() &&
              !source.isDiscoveringRelationDatabases()
            ) {
              discoveryTriggered = true;
              queueMicrotask(() => {
                source.discoverRelationDatabases().catch(() => {});
              });
            }

            const databases = source.relationDatabases();
            const data = property.data$.value;
            const scanning = source.isDiscoveringRelationDatabases();
            const hasUnloaded = source.hasUnloadedRelationDocs();
            const items: MenuConfig[] = [];

            if (databases.length === 0 && !scanning) {
              items.push(
                message(
                  'No databases found yet. Create a database on a page or scan workspace pages.'
                )
              );
            } else {
              items.push(
                ...databases.map(database =>
                  menu.action({
                    name: database.title,
                    isSelected:
                      database.docId === data.targetDocId &&
                      database.databaseId === data.targetDatabaseId,
                    select: () => {
                      const current = property.data$.value;
                      if (
                        database.docId === current.targetDocId &&
                        database.databaseId === current.targetDatabaseId
                      ) {
                        return;
                      }
                      source
                        .configureRelationAsync(property.id, {
                          targetDocId: database.docId,
                          targetDatabaseId: database.databaseId,
                          reciprocal: Boolean(current.reciprocal),
                        })
                        .catch(() => {});
                    },
                  })
                )
              );
            }

            if (scanning) {
              items.push(message('Scanning workspace pages for databases...'));
            } else if (hasUnloaded) {
              items.push(
                menu.action({
                  name: 'Scan workspace pages',
                  closeOnSelect: false,
                  select: () => {
                    source
                      .discoverRelationDatabases({ force: true })
                      .catch(() => {});
                    return false;
                  },
                })
              );
            }

            return items;
          }),
        ],
      },
    }),
    menu.checkbox({
      name: 'Two-way relation',
      checked: reciprocalChecked$,
      select: checked => {
        source
          .configureRelationAsync(property.id, {
            reciprocal: !checked,
          })
          .catch(() => {});
        return false;
      },
    }),
    menu.dynamic(() => {
      const parsed = relationDataSchema.safeParse(property.data$.value);
      if (
        !parsed.success ||
        !parsed.data.reciprocal ||
        !parsed.data.reciprocalColumnId
      ) {
        return [];
      }
      const target = source.relationTarget(parsed.data);
      const pairedName = target?.propertyNameGet(
        parsed.data.reciprocalColumnId
      );
      if (!pairedName) return [];
      return [message(`Synced with "${pairedName}" in related database.`)];
    }),
  ];
}

function formulaConfig(property: Property): MenuConfig[] {
  return [
    menu.action({
      name: 'Edit formula',
      select: ele => {
        popFormulaEditor(ele, property);
      },
    }),
    menu.subMenu({
      name: 'Result type',
      options: {
        items: [
          menu.dynamic(() =>
            FORMULA_RESULT_TYPES.map(item =>
              menu.action({
                name: item.label,
                isSelected: property.data$.value.resultType === item.value,
                select: () =>
                  property.dataUpdate(() => ({ resultType: item.value })),
              })
            )
          ),
        ],
      },
    }),
  ];
}

function rollupConfig(property: Property): MenuConfig[] {
  const source = sourceFor(property);
  const data = property.data$.value;
  const relations = source.properties$.value.filter(
    id => source.propertyTypeGet(id) === 'relation'
  );
  const relationData = source.propertyDataGet(
    String(data.relationColumnId ?? '')
  );
  const target = source.relationTarget({
    targetDocId: String(relationData.targetDocId ?? ''),
    targetDatabaseId: String(relationData.targetDatabaseId ?? ''),
  });
  return [
    menu.subMenu({
      name: 'Configure rollup',
      options: {
        items: [
          menu.subMenu({
            name: 'Relation',
            options: {
              items: relations.map(id =>
                menu.action({
                  name: source.propertyNameGet(id),
                  isSelected: data.relationColumnId === id,
                  select: () =>
                    property.dataUpdate(() => ({
                      relationColumnId: id,
                      targetColumnId: '',
                    })),
                })
              ),
            },
          }),
          menu.subMenu({
            name: 'Target property',
            options: {
              items: target
                ? target.properties$.value.map(id =>
                    menu.action({
                      name: target.propertyNameGet(id),
                      isSelected: data.targetColumnId === id,
                      select: () =>
                        property.dataUpdate(() => ({ targetColumnId: id })),
                    })
                  )
                : [
                    message(
                      'Select a relation. Its database may still be loading.'
                    ),
                  ],
            },
          }),
          menu.subMenu({
            name: 'Operation',
            options: {
              items: [
                'count',
                'sum',
                'avg',
                'min',
                'max',
                'values',
                'unique',
              ].map(operation =>
                menu.action({
                  name:
                    operation === 'avg'
                      ? 'Average'
                      : operation === 'values'
                        ? 'Show values'
                        : operation === 'unique'
                          ? 'Unique values'
                          : operation,
                  isSelected: data.operation === operation,
                  select: () => property.dataUpdate(() => ({ operation })),
                })
              ),
            },
          }),
        ],
      },
    }),
  ];
}

export class ComputedCell extends BaseCellRenderer {
  override beforeEnterEditMode() {
    return false;
  }

  private readonly handleFormulaClick = (event: MouseEvent) => {
    if (this.property.type$.value !== 'formula' || this.view.readonly$.value) {
      return;
    }
    event.stopPropagation();
    popFormulaEditor(this, this.property);
  };

  override render() {
    const isFormula = this.property.type$.value === 'formula';
    const canEditFormula = isFormula && !this.view.readonly$.value;
    const isError = isComputedError(this.value);
    const hasEmptyExpression =
      isFormula && !String(this.property.data$.value.expression ?? '').trim();
    const rawResultType = this.property.data$.value.resultType;
    const displayText =
      hasEmptyExpression && canEditFormula
        ? 'Edit formula…'
        : isFormula &&
            rawResultType === 'date' &&
            typeof this.value === 'number'
          ? formatFormulaPreviewValue(this.value, 'date')
          : computedText(this.value);
    const tooltip = computedText(this.value);
    const colorStyle =
      hasEmptyExpression && canEditFormula
        ? 'color:var(--affine-text-secondary-color);font-style:italic;'
        : isError
          ? 'color:var(--affine-error-color, #c9342a);'
          : '';
    const cursorStyle = canEditFormula ? 'cursor:pointer;' : '';

    return html`<div
      style=${`display:flex;align-items:center;width:100%;min-height:24px;padding:0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${colorStyle}${cursorStyle}`}
      title=${tooltip}
      @click=${this.handleFormulaClick}
    >
      ${displayText}
    </div>`;
  }
}

export class RelationCell extends BaseCellRenderer<string[], string[]> {
  private readonly toggle = (id: string, checked: boolean) => {
    if (this.readonly) return;
    const selected = new Set(this.value ?? []);
    if (checked) selected.add(id);
    else selected.delete(id);
    this.valueSetImmediate([...selected]);
  };
  private openTarget(event: MouseEvent) {
    event.stopPropagation();
    const host = this.view.serviceGet(EditorHostKey);
    const docId = String(this.property.data$.value.targetDocId ?? '');
    if (host && docId)
      host.std
        .getOptional(RefNodeSlotsProvider)
        ?.docLinkClicked.next({ pageId: docId, host });
  }
  override render() {
    const options = sourceFor(this.property).relationOptions(this.property.id);
    const titles = new Map(options?.map(option => [option.id, option.title]));
    const selected = this.value ?? [];
    if (this.isEditing$.value && !this.readonly) {
      return html`<div
        style="max-height:240px;overflow:auto;padding:6px"
        @pointerdown=${(event: Event) => event.stopPropagation()}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Escape') this.selectCurrentCell(false);
          event.stopPropagation();
        }}
      >
        ${
          options
            ? options.map(
                option =>
                  html`<label style="display:flex;gap:6px"
                    ><input
                      type="checkbox"
                      .checked=${selected.includes(option.id)}
                      @change=${(event: Event) =>
                        this.toggle(
                          option.id,
                          (event.target as HTMLInputElement).checked
                        )}
                    />${option.title}</label
                  >`
              )
            : html`<span
                >Configure the related database in the column menu. Its page may
                be loading or unavailable.</span
              >`
        }
        ${selected
          .filter(id => !titles.has(id))
          .map(
            id =>
              html`<label style="display:flex;gap:6px"
                ><input
                  type="checkbox"
                  checked
                  @change=${(event: Event) =>
                    this.toggle(id, (event.target as HTMLInputElement).checked)}
                />Unresolved row (${id})</label
              >`
          )}
      </div>`;
    }
    return html`<div
      style="padding:0 6px;overflow:hidden;text-overflow:ellipsis"
    >
      ${selected.map(
        id =>
          html`<button
            style="font:inherit;color:inherit;border:0;background:transparent"
            @click=${(event: MouseEvent) => this.openTarget(event)}
          >
            ${titles.get(id) ?? `Unresolved row (${id})`}
          </button>`
      )}
    </div>`;
  }
}

export const relationColumnConfig =
  relationPropertyModelConfig.createPropertyMeta({
    icon: createIcon('LinkIcon'),
    cellRenderer: { view: createFromBaseCellRenderer(RelationCell) },
    propertyConfig: relationConfig,
  });
export const formulaColumnConfig =
  formulaPropertyModelConfig.createPropertyMeta({
    icon: createIcon('NumberIcon'),
    cellRenderer: { view: createFromBaseCellRenderer(ComputedCell) },
    propertyConfig: formulaConfig,
  });
export const rollupColumnConfig = rollupPropertyModelConfig.createPropertyMeta({
  icon: createIcon('NumberIcon'),
  cellRenderer: { view: createFromBaseCellRenderer(ComputedCell) },
  propertyConfig: rollupConfig,
});
