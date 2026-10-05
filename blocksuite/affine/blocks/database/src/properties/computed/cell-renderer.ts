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
import { html } from 'lit';

import { EditorHostKey } from '../../context/host-context.js';
import type { DatabaseBlockDataSource } from '../../data-source.js';
import {
  formulaPropertyModelConfig,
  relationPropertyModelConfig,
  rollupPropertyModelConfig,
} from './define.js';
import { computedText } from './evaluate.js';

const sourceFor = (property: Property) =>
  property.view.manager.dataSource as DatabaseBlockDataSource;
const message =
  (text: string): MenuConfig =>
  () =>
    html`<p
      style="margin:8px;font-size:12px;max-width:280px;white-space:normal"
    >
      ${text}
    </p>`;

function relationConfig(property: Property): MenuConfig[] {
  const source = sourceFor(property);
  const databases = source.relationDatabases();
  const data = property.data$.value;
  return [
    menu.subMenu({
      name: 'Related database',
      options: {
        items: [
          message(
            'Choose a database from an open page. Open a target page first if it is not listed.'
          ),
          ...databases.map(database =>
            menu.action({
              name: database.title,
              isSelected:
                database.docId === data.targetDocId &&
                database.databaseId === data.targetDatabaseId,
              select: () => {
                if (
                  database.docId === data.targetDocId &&
                  database.databaseId === data.targetDatabaseId
                )
                  return;
                // Existing identities are never silently reinterpreted as rows in a new target.
                source.doc.captureSync();
                source.doc.transact(() => {
                  source.rows$.value.forEach(row =>
                    source.cellValueChange(row, property.id, [])
                  );
                  property.dataUpdate(() => ({
                    targetDocId: database.docId,
                    targetDatabaseId: database.databaseId,
                  }));
                });
              },
            })
          ),
        ],
      },
    }),
  ];
}

function formulaConfig(property: Property): MenuConfig[] {
  const source = sourceFor(property);
  const data = property.data$.value;
  return [
    menu.subMenu({
      name: 'Edit formula',
      options: {
        items: [
          message(
            'Use prop("column ID"), + - * /, comparisons, if, concat, lower, upper, length, round, date, dateAdd or dateDiff. Date helpers use UTC days.'
          ),
          menu.input({
            initialValue: String(data.expression ?? ''),
            placeholder: 'Formula expression',
            onBlur: expression => property.dataUpdate(() => ({ expression })),
            onComplete: expression =>
              property.dataUpdate(() => ({ expression })),
          }),
          menu.subMenu({
            name: 'Insert property reference',
            options: {
              items: source.properties$.value
                .filter(id => id !== property.id)
                .map(id =>
                  menu.action({
                    name: source.propertyNameGet(id),
                    select: () =>
                      property.dataUpdate(current => ({
                        expression: `${current.expression ?? ''}prop(${JSON.stringify(id)})`,
                      })),
                  })
                ),
            },
          }),
          menu.subMenu({
            name: 'Result type',
            options: {
              items: ['number', 'string', 'boolean', 'date'].map(resultType =>
                menu.action({
                  name: resultType,
                  isSelected: data.resultType === resultType,
                  select: () => property.dataUpdate(() => ({ resultType })),
                })
              ),
            },
          }),
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
                      'Select a relation and open its target page first.'
                    ),
                  ],
            },
          }),
          menu.subMenu({
            name: 'Operation',
            options: {
              items: ['count', 'sum', 'avg', 'min', 'max'].map(operation =>
                menu.action({
                  name: operation === 'avg' ? 'Average' : operation,
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
  override render() {
    return html`<span
      style="padding:0 6px;overflow:hidden;text-overflow:ellipsis"
      title=${computedText(this.value)}
      >${computedText(this.value)}</span
    >`;
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
        ${options
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
              >Configure the related database in the column menu and open its
              page.</span
            >`}
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
