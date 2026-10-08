import type {
  ColumnDataType,
  ColumnUpdater,
  DatabaseBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/affine-model';
import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import { FeatureFlagService } from '@blocksuite/affine-shared/services';
import {
  insertPositionToIndex,
  type InsertToPosition,
} from '@blocksuite/affine-shared/utils';
import {
  type DatabaseFlags,
  DataSourceBase,
  type DataViewDataType,
  type PropertyMetaConfig,
  type TypeInstance,
  type ViewManager,
  ViewManagerBase,
  type ViewMeta,
} from '@blocksuite/data-view';
import { propertyPresets } from '@blocksuite/data-view/property-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import type { EditorHost } from '@blocksuite/std';
import { type BlockModel, type Doc, type Store } from '@blocksuite/store';
import {
  computed,
  effect,
  type ReadonlySignal,
  type Signal,
  signal,
  untracked,
} from '@preact/signals-core';

import { getIcon } from './block-icons.js';
import {
  formulaDataSchema,
  type RelationData,
  relationDataSchema,
  rollupDataSchema,
} from './properties/computed/define.js';
import {
  aggregateRollup,
  computedText,
  type ComputedValue,
  evaluateFormula,
  isComputedError,
} from './properties/computed/evaluate.js';
import {
  databaseBlockProperties,
  databasePropertyConverts,
} from './properties/index.js';
import {
  addProperty,
  copyCellsByProperty,
  deleteRows,
  deleteView,
  duplicateView,
  getCell,
  getProperty,
  moveViewTo,
  updateCell,
  updateCells,
  updateProperty,
  updateView,
} from './utils/block-utils.js';
import {
  databaseBlockViewConverts,
  databaseBlockViewMap,
  databaseBlockViews,
} from './views/index.js';

type ComputationContext = {
  visiting: Set<string>;
  cache: Map<string, unknown>;
  remaining: number;
};

type SpacialProperty = {
  valueSet: (rowId: string, propertyId: string, value: unknown) => void;
  valueGet: (rowId: string, propertyId: string) => unknown;
};

type RelationDocument = {
  doc: Doc;
  status: ReturnType<typeof signal<'loading' | 'ready' | 'unavailable'>>;
  ready: Promise<void>;
  release: () => void;
};

type RelationDocuments = {
  documents: Map<string, RelationDocument>;
  revision: ReadonlySignal<number>;
  owners: Signal<number>;
  leases: Set<() => void>;
};

export type RelationTargetsLease = {
  ready: Promise<void>;
  release: () => void;
};

export class DatabaseBlockDataSource extends DataSourceBase {
  private static readonly relationDocuments = new WeakMap<
    DatabaseBlockModel,
    RelationDocuments
  >();
  private static readonly workspaceRevisions = new WeakMap<
    Store,
    ReadonlySignal<number>
  >();

  private get workspaceRevision() {
    let revision = DatabaseBlockDataSource.workspaceRevisions.get(this.doc);
    if (!revision) {
      const updates = signal(0);
      this.doc.disposableGroup.add(
        this.doc.workspace.meta.docMetaUpdated.subscribe(() => {
          updates.value++;
        })
      );
      revision = updates;
      DatabaseBlockDataSource.workspaceRevisions.set(this.doc, revision);
    }
    return revision.value;
  }
  override get parentProvider() {
    return this._model.store.provider;
  }

  spacialProperties: Record<string, SpacialProperty> = {
    'created-time': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as ParagraphBlockModel;
        if (!model) {
          return null;
        }
        return model.props['meta:createdAt'];
      },
    },
    'created-by': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as
          | ParagraphBlockModel
          | undefined;
        return model ? model.props['meta:createdBy'] : null;
      },
    },
    type: {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId);
        if (!model) {
          return;
        }
        return getIcon(model);
      },
    },
    title: {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId);
        if (!model) {
          return;
        }
        return model.text;
      },
    },
  };

  isSpacialProperty(propertyType: string): boolean {
    return this.spacialProperties[propertyType] !== undefined;
  }

  spacialValueGet(
    rowId: string,
    propertyId: string,
    propertyType: string
  ): unknown {
    return this.spacialProperties[propertyType]?.valueGet(rowId, propertyId);
  }

  static externalProperties = signal<PropertyMetaConfig[]>([]);
  static propertiesList = computed(() => {
    return [
      ...Object.values(databaseBlockProperties),
      ...this.externalProperties.value,
    ];
  });
  static propertiesMap = computed(() => {
    return Object.fromEntries(
      this.propertiesList.value.map(v => [v.type, v as PropertyMetaConfig])
    );
  });

  private _batch = 0;

  private readonly _model: DatabaseBlockModel;

  override featureFlags$: ReadonlySignal<DatabaseFlags> = computed(() => {
    const featureFlagService = this.doc.get(FeatureFlagService);
    const enableTableVirtualScroll = featureFlagService.getFlag(
      'enable_table_virtual_scroll'
    );
    return {
      enable_table_virtual_scroll: enableTableVirtualScroll ?? false,
    };
  });

  properties$: ReadonlySignal<string[]> = computed(() => {
    const fixedPropertiesSet = new Set(this.fixedProperties$.value);
    const properties: string[] = [];
    this._model.props.columns$.value.forEach(column => {
      if (fixedPropertiesSet.has(column.type)) {
        fixedPropertiesSet.delete(column.type);
      }
      properties.push(column.id);
    });

    const result = [...fixedPropertiesSet, ...properties];
    return result;
  });

  readonly$: ReadonlySignal<boolean> = computed(() => {
    return (
      this._model.store.readonly ||
      this.relationReadonly ||
      (IS_MOBILE &&
        !this._model.store.provider
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing'))
    );
  });

  rows$: ReadonlySignal<string[]> = computed(() => {
    return this._model.children.map(v => v.id);
  });

  viewConverts = databaseBlockViewConverts;

  viewDataList$: ReadonlySignal<DataViewDataType[]> = computed(() => {
    return this._model.props.views$.value as DataViewDataType[];
  });

  override viewManager: ViewManager = new ViewManagerBase(this);

  viewMetas = databaseBlockViews;

  get doc() {
    return this._model.store;
  }

  allPropertyMetas$ = computed<PropertyMetaConfig<any, any, any, any>[]>(() => {
    return DatabaseBlockDataSource.propertiesList.value;
  });

  propertyMetas$ = computed<PropertyMetaConfig[]>(() => {
    return this.allPropertyMetas$.value.filter(
      v => !v.config.fixed && !v.config.hide
    );
  });

  constructor(
    model: DatabaseBlockModel,
    init?: (dataSource: DatabaseBlockDataSource) => void,
    private readonly relationReadonly = false
  ) {
    super();
    this._model = model; // ensure invariants first
    init?.(this); // then allow external initialisation
  }

  private _runCapture() {
    if (this._batch) {
      return;
    }

    this._batch = requestAnimationFrame(() => {
      this.doc.captureSync();
      this._batch = 0;
    });
  }

  private getModelById(rowId: string): BlockModel | undefined {
    return this._model.children[this._model.childMap.value.get(rowId) ?? -1];
  }

  private newPropertyName(prefix = 'Column'): string {
    let i = 1;
    const hasSameName = (name: string) => {
      return this._model.props.columns$.value.some(
        column => column.name === name
      );
    };
    while (true) {
      let name = i === 1 ? prefix : `${prefix} ${i}`;
      if (!hasSameName(name)) {
        return name;
      }
      i++;
    }
  }

  cellValueChange(rowId: string, propertyId: string, value: unknown): void {
    if (this.readonly$.value || this.propertyReadonlyGet(propertyId)) return;
    if (!this.rows$.value.includes(rowId)) return;
    this._runCapture();

    const type = this.propertyTypeGet(propertyId);
    if (type == null) {
      return;
    }
    const update = this.propertyMetaGet(type)?.config.rawValue.setValue;
    const old = this.cellValueGet(rowId, propertyId);
    const updateFn =
      update ??
      (({ setValue, newValue }) => {
        setValue(newValue);
      });
    updateFn({
      value: old,
      data: this.propertyDataGet(propertyId),
      dataSource: this,
      newValue: value,
      setValue: newValue => {
        if (this._model.props.columns$.value.some(v => v.id === propertyId)) {
          updateCell(this._model, rowId, {
            columnId: propertyId,
            value: newValue,
          });
        }
      },
    });
  }

  cellValueGet(rowId: string, propertyId: string): unknown {
    return this.resolveValue(rowId, propertyId, {
      visiting: new Set(),
      cache: new Map(),
      remaining: 512,
    });
  }

  private resolveValue(
    rowId: string,
    propertyId: string,
    context: ComputationContext
  ): unknown {
    if (--context.remaining < 0)
      return { error: 'Property evaluation limit exceeded' };
    if (this.isSpacialProperty(propertyId)) {
      return this.spacialValueGet(rowId, propertyId, propertyId);
    }
    const type = this.propertyTypeGet(propertyId);
    if (!type) {
      return;
    }
    if (type === 'formula' || type === 'rollup') {
      const key = JSON.stringify([
        this.doc.doc.id,
        this._model.id,
        rowId,
        propertyId,
      ]);
      if (context.cache.has(key)) return context.cache.get(key);
      if (context.visiting.has(key))
        return { error: 'Circular property reference' };
      if (context.visiting.size >= 32)
        return { error: 'Property dependency limit exceeded' };
      context.visiting.add(key);
      try {
        const result = this.computedValue(rowId, propertyId, type, context);
        context.cache.set(key, result);
        return result;
      } finally {
        context.visiting.delete(key);
      }
    }
    if (this.isSpacialProperty(type)) {
      return this.spacialValueGet(rowId, propertyId, type);
    }
    const meta = this.propertyMetaGet(type);
    if (!meta) {
      return;
    }
    const rawValue =
      getCell(this._model, rowId, propertyId)?.value ??
      meta.config.rawValue.default();
    const schema = meta.config.rawValue.schema;
    const result = schema.safeParse(rawValue);
    if (result.success) {
      return result.data;
    }
    return;
  }

  private get relatedDocuments(): RelationDocuments {
    const existing = DatabaseBlockDataSource.relationDocuments.get(this._model);
    if (existing) return existing;
    const documents = new Map<string, RelationDocument>();
    const revision = signal(0);
    const owners = signal(0);
    const result = {
      documents,
      revision,
      owners,
      leases: new Set<() => void>(),
    };
    DatabaseBlockDataSource.relationDocuments.set(this._model, result);
    const stop = effect(() => {
      const required = new Map<string, Doc>();
      if (owners.value > 0 && this.doc.blocks.value[this._model.id]) {
        void this.workspaceRevision;
        for (const column of this._model.props.columns$.value) {
          if (column.type !== 'relation') continue;
          const data = relationDataSchema.safeParse(column.data);
          if (!data.success || !data.data.targetDatabaseId) continue;
          const doc = this.doc.workspace.getDoc(data.data.targetDocId);
          if (doc && !doc.meta?.trash && doc.id !== this.doc.doc.id)
            required.set(doc.id, doc);
        }
      }
      untracked(() => {
        for (const [id, entry] of documents) {
          if (required.get(id) !== entry.doc) {
            entry.release();
            documents.delete(id);
          }
        }
        for (const [id, doc] of required) {
          if (documents.has(id)) continue;
          const entry: RelationDocument = {
            doc,
            status: signal('loading'),
            ready: Promise.resolve(),
            release: () => {},
          };
          documents.set(id, entry);
          try {
            const lease = this.doc.workspace.acquireDoc?.(id);
            if (lease) {
              let releaseReady!: () => void;
              const released = new Promise<void>(resolve => {
                releaseReady = resolve;
              });
              let isReleased = false;
              entry.release = () => {
                if (isReleased) return;
                isReleased = true;
                releaseReady();
                lease.release();
              };
              entry.ready = Promise.race([
                released,
                lease.ready.then(
                  () => {
                    if (documents.get(id) === entry)
                      entry.status.value = 'ready';
                  },
                  () => {
                    if (documents.get(id) === entry)
                      entry.status.value = 'unavailable';
                  }
                ),
              ]);
            } else {
              // Detached imports and test workspaces load synchronously.
              doc.load();
              entry.status.value = 'ready';
            }
          } catch {
            entry.status.value = 'unavailable';
          }
        }
        revision.value++;
      });
    });
    this.doc.disposableGroup.add(() => {
      stop();
      documents.forEach(entry => entry.release());
      documents.clear();
      result.leases.forEach(release => release());
      DatabaseBlockDataSource.relationDocuments.delete(this._model);
    });
    return result;
  }

  /** Retain local target loading for an editor or export; release on final close. */
  acquireRelationTargets(
    ancestors = new Set<DatabaseBlockModel>()
  ): RelationTargetsLease {
    const related = this.relatedDocuments;
    related.owners.value++;
    const visited = new Set(ancestors).add(this._model);
    const nested = new Map<DatabaseBlockModel, RelationTargetsLease>();
    const stop = effect(() => {
      const required = new Map<DatabaseBlockModel, DatabaseBlockDataSource>();
      const columns = this.doc.blocks.value[this._model.id]
        ? this._model.props.columns$.value
        : [];
      for (const column of columns) {
        if (column.type !== 'relation') continue;
        const data = relationDataSchema.safeParse(column.data);
        const target = data.success
          ? this.relationTarget(data.data)
          : undefined;
        if (target && !visited.has(target._model))
          required.set(target._model, target);
      }
      untracked(() => {
        for (const [model, lease] of nested) {
          if (!required.has(model)) {
            lease.release();
            nested.delete(model);
          }
        }
        for (const [model, target] of required) {
          if (!nested.has(model))
            nested.set(model, target.acquireRelationTargets(visited));
        }
      });
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      stop();
      nested.forEach(lease => lease.release());
      nested.clear();
      related.owners.value--;
      related.leases.delete(release);
    };
    related.leases.add(release);
    const ready = (async () => {
      while (!released) {
        await this.waitForRelationTargets();
        const leases = [...nested.values()];
        await Promise.all(leases.map(lease => lease.ready));
        if (
          leases.length === nested.size &&
          leases.every(lease => [...nested.values()].includes(lease))
        )
          return;
      }
    })();
    return { ready, release };
  }

  /** Local readiness only; the caller owns an acquireRelationTargets lease. */
  async waitForRelationTargets(): Promise<void> {
    const related = this.relatedDocuments;
    while (related.owners.peek() > 0) {
      const entries = [...related.documents.values()];
      await Promise.all(entries.map(entry => entry.ready));
      if (
        entries.length === related.documents.size &&
        entries.every(entry => related.documents.get(entry.doc.id) === entry)
      )
        return;
    }
  }

  relationTargetStatus(
    data: RelationData
  ): 'loading' | 'ready' | 'unavailable' {
    void this.workspaceRevision;
    if (!data.targetDocId || !data.targetDatabaseId) return 'unavailable';
    const doc = this.doc.workspace.getDoc(data.targetDocId);
    if (!doc || doc.meta?.trash) return 'unavailable';
    if (doc.id === this.doc.doc.id) return 'ready';
    const related = this.relatedDocuments;
    void related.revision.value;
    if (!this.doc.workspace.acquireDoc && !doc.ready) doc.load();
    return (
      related.documents.get(doc.id)?.status.value ??
      (doc.ready ? 'ready' : 'unavailable')
    );
  }

  // Readonly target sources share the canonical Store used by DocsService. A
  // separate Store projection would miss same-process local proxy edits.
  // The loading lease is
  // released when a column is removed/retargeted or the source Store is disposed.
  relationTarget(data: RelationData): DatabaseBlockDataSource | undefined {
    if (this.relationTargetStatus(data) !== 'ready') return;
    const doc = this.doc.workspace.getDoc(data.targetDocId);
    if (!doc || doc.meta?.trash) return;
    const store =
      doc.id === this.doc.doc.id ? this.doc : doc.getStore({ id: doc.id });
    const model = store.blocks.value[data.targetDatabaseId]?.model;
    if (!doc.ready || model?.flavour !== 'affine:database') return;
    return new DatabaseBlockDataSource(
      model as DatabaseBlockModel,
      undefined,
      true
    );
  }

  relationOptions(
    propertyId: string
  ): { id: string; title: string }[] | undefined {
    const data = relationDataSchema.safeParse(this.propertyDataGet(propertyId));
    const target = data.success ? this.relationTarget(data.data) : undefined;
    if (!target) return;
    return target.rows$.value.map(id => {
      const title = target.cellValueGet(id, 'title');
      if (title && typeof title === 'object' && 'deltas$' in title) {
        void (title.deltas$ as ReadonlySignal<unknown>).value;
      }
      return { id, title: String(title ?? '') || 'Untitled' };
    });
  }

  relationDatabases(): { docId: string; databaseId: string; title: string }[] {
    void this.workspaceRevision;
    const result: { docId: string; databaseId: string; title: string }[] = [];
    for (const doc of this.doc.workspace.docs.values()) {
      if (!doc.ready || doc.meta?.trash) continue;
      const store =
        doc.id === this.doc.doc.id ? this.doc : doc.getStore({ id: doc.id });
      for (const block of Object.values(store.blocks.value)) {
        if (block.model.flavour !== 'affine:database') continue;
        const model = block.model as DatabaseBlockModel;
        result.push({
          docId: doc.id,
          databaseId: model.id,
          title: `${doc.meta?.title || 'Untitled'} / ${model.props.title?.toString() || 'Database'}`,
        });
      }
    }
    return result;
  }

  private computedValue(
    rowId: string,
    propertyId: string,
    type: string,
    context: ComputationContext
  ): ComputedValue {
    if (type === 'formula') {
      const data = formulaDataSchema.safeParse(
        this.propertyDataGet(propertyId)
      );
      if (!data.success) return { error: 'Invalid formula configuration' };
      const result = evaluateFormula(data.data.expression, id => {
        if (!this.propertyTypeGet(id))
          return { error: 'Referenced property is missing' };
        const value = this.resolveValue(rowId, id, context);
        if (value && typeof value === 'object' && 'deltas$' in value) {
          // Text.toString itself is not reactive; subscribe to its existing signal.
          void (value.deltas$ as ReadonlySignal<unknown>).value;
        }
        return value;
      });
      if (result == null || isComputedError(result)) return result;
      const expected =
        data.data.resultType === 'date' ? 'number' : data.data.resultType;
      return typeof result === expected
        ? result
        : { error: `Formula result must be ${expected}` };
    }
    const data = rollupDataSchema.safeParse(this.propertyDataGet(propertyId));
    if (!data.success || !data.data.relationColumnId)
      return { error: 'Configure the rollup' };
    if (this.propertyTypeGet(data.data.relationColumnId) !== 'relation')
      return { error: 'Relation property is missing' };
    const relation = relationDataSchema.safeParse(
      this.propertyDataGet(data.data.relationColumnId)
    );
    const target = relation.success
      ? this.relationTarget(relation.data)
      : undefined;
    if (!target)
      return {
        error:
          relation.success &&
          this.relationTargetStatus(relation.data) === 'loading'
            ? 'Related database is loading'
            : 'Related database is unavailable',
      };
    const rows = this.resolveValue(rowId, data.data.relationColumnId, context);
    if (!Array.isArray(rows)) return { error: 'Invalid relation value' };
    if (
      rows.some(
        id => typeof id !== 'string' || !target.rows$.value.includes(id)
      )
    )
      return { error: 'Related row is missing' };
    if (data.data.operation === 'count') return rows.length;
    if (!target.propertyTypeGet(data.data.targetColumnId))
      return { error: 'Rollup property is missing' };
    return aggregateRollup(
      data.data.operation,
      rows.map(id => {
        const value = target.resolveValue(
          id,
          data.data.targetColumnId,
          context
        );
        if (
          data.data.operation !== 'values' &&
          data.data.operation !== 'unique'
        )
          return value;
        return target.readableRollupValue(data.data.targetColumnId, value);
      })
    );
  }

  private readableRollupValue(propertyId: string, value: unknown): unknown {
    if (isComputedError(value) || value == null) return value;
    if (value && typeof value === 'object' && 'deltas$' in value)
      void (value.deltas$ as ReadonlySignal<unknown>).value;
    const type = this.propertyTypeGet(propertyId);
    const data = this.propertyDataGet(propertyId);
    if (type === 'select' || type === 'multi-select') {
      const options = data.options as
        | { id: string; value: string }[]
        | undefined;
      return (Array.isArray(value) ? value : [value]).map(
        id =>
          options?.find(option => option.id === id)?.value ??
          `Unresolved choice (${String(id)})`
      );
    }
    if (Array.isArray(value)) return value.map(computedText);
    if (this.isSpacialProperty(type ?? '') || type === 'formula')
      return computedText(value);
    const meta = type ? this.propertyMetaGet(type) : undefined;
    return (
      meta?.config.rawValue.toString({ value, data }) ?? computedText(value)
    );
  }

  propertyAdd(
    insertToPosition: InsertToPosition,
    ops?: {
      type?: string;
      name?: string;
    }
  ): string | undefined {
    this.doc.captureSync();
    const { type, name } = ops ?? {};
    const property = this.propertyMetaGet(
      type ?? propertyPresets.multiSelectPropertyConfig.type
    );
    if (!property) {
      return;
    }
    const result = addProperty(
      this._model,
      insertToPosition,
      property.create(this.newPropertyName(name))
    );
    return result;
  }

  protected override getNormalPropertyAndIndex(propertyId: string):
    | {
        column: ColumnDataType<Record<string, unknown>>;
        index: number;
      }
    | undefined {
    const index = this._model.props.columns$.value.findIndex(
      v => v.id === propertyId
    );
    if (index >= 0) {
      const column = this._model.props.columns$.value[index];
      if (!column) {
        return;
      }
      return {
        column,
        index,
      };
    }
    return;
  }

  private getPropertyAndIndex(propertyId: string):
    | {
        column: ColumnDataType<Record<string, unknown>>;
        index: number;
      }
    | undefined {
    const result = this.getNormalPropertyAndIndex(propertyId);
    if (result) {
      return result;
    }
    if (this.isFixedProperty(propertyId)) {
      const meta = this.propertyMetaGet(propertyId);
      if (!meta) {
        return;
      }
      const defaultData = meta.config.fixed?.defaultData ?? {};
      return {
        column: {
          data: defaultData,
          id: propertyId,
          type: propertyId,
          name: meta.config.name,
        },
        index: -1,
      };
    }
    return undefined;
  }

  private updateProperty(id: string, updater: ColumnUpdater) {
    const result = this.getPropertyAndIndex(id);
    if (!result) {
      return;
    }
    const { column: prevColumn, index } = result;
    this._model.store.transact(() => {
      if (index >= 0) {
        const result = updater(prevColumn);
        this._model.props.columns[index] = { ...prevColumn, ...result };
      } else {
        const result = updater(prevColumn);
        this._model.props.columns = [
          ...this._model.props.columns,
          { ...prevColumn, ...result },
        ];
      }
    });
    return id;
  }

  propertyDataGet(propertyId: string): Record<string, unknown> {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return {};
    }
    return result.column.data;
  }

  propertyDataSet(propertyId: string, data: Record<string, unknown>): void {
    this._runCapture();
    this.updateProperty(propertyId, () => ({ data }));
  }

  propertyDataTypeGet(propertyId: string): TypeInstance | undefined {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return;
    }
    const { column } = result;
    const meta = this.propertyMetaGet(column.type);
    if (!meta) {
      return;
    }
    return meta.config?.jsonValue.type({
      data: column.data,
      dataSource: this,
    });
  }

  propertyDelete(id: string): void {
    if (this.isFixedProperty(id)) {
      return;
    }
    this.doc.captureSync();
    const index = this._model.props.columns.findIndex(v => v.id === id);
    if (index < 0) return;

    this.doc.transact(() => {
      this._model.props.columns = this._model.props.columns.filter(
        (_, i) => i !== index
      );
    });
  }

  propertyDuplicate(propertyId: string): string | undefined {
    if (this.isFixedProperty(propertyId)) {
      return;
    }
    this.doc.captureSync();
    const currentSchema = getProperty(this._model, propertyId);
    if (!currentSchema) {
      return;
    }
    const { id: copyId, ...nonIdProps } = currentSchema;
    const names = new Set(this._model.props.columns$.value.map(v => v.name));
    let index = 1;
    while (names.has(`${nonIdProps.name}(${index})`)) {
      index++;
    }
    const schema = { ...nonIdProps, name: `${nonIdProps.name}(${index})` };
    const id = addProperty(
      this._model,
      {
        before: false,
        id: propertyId,
      },
      schema
    );
    copyCellsByProperty(this._model, copyId, id);
    return id;
  }

  propertyMetaGet(type: string): PropertyMetaConfig | undefined {
    return DatabaseBlockDataSource.propertiesMap.value[type];
  }

  propertyNameGet(propertyId: string): string {
    if (propertyId === 'type') {
      return 'Block Type';
    }
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return '';
    }
    return result.column.name;
  }

  propertyNameSet(propertyId: string, name: string): void {
    this.doc.captureSync();
    this.updateProperty(propertyId, () => ({ name }));
  }

  override propertyReadonlyGet(propertyId: string): boolean {
    if (propertyId === 'type') return true;
    const type = this.propertyTypeGet(propertyId);
    if (type === 'formula' || type === 'rollup') return true;
    return false;
  }

  propertyTypeGet(propertyId: string): string | undefined {
    if (propertyId === 'type') {
      return 'image';
    }
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return;
    }
    return result.column.type;
  }

  propertyTypeSet(propertyId: string, toType: string): void {
    if (this.isFixedProperty(propertyId)) {
      return;
    }
    const meta = this.propertyMetaGet(toType);
    if (!meta) {
      return;
    }
    const currentType = this.propertyTypeGet(propertyId);
    const currentData = this.propertyDataGet(propertyId);
    const rows = this.rows$.value;
    const currentCells = rows.map(rowId =>
      this.cellValueGet(rowId, propertyId)
    );
    const convertFunction = databasePropertyConverts.find(
      v => v.from === currentType && v.to === toType
    )?.convert;
    const result = convertFunction?.(
      currentData as any,

      currentCells as any
    ) ?? {
      property: meta.config.propertyData.default(),
      cells: currentCells.map(() => undefined),
    };
    this.doc.captureSync();
    updateProperty(this._model, propertyId, () => ({
      type: toType,
      data: result.property,
    }));
    const cells: Record<string, unknown> = {};
    currentCells.forEach((value, i) => {
      if (value != null || result.cells[i] != null) {
        const rowId = rows[i];
        if (rowId) {
          cells[rowId] = result.cells[i];
        }
      }
    });
    updateCells(this._model, propertyId, cells);
  }

  rowAdd(insertPosition: InsertToPosition | number): string {
    this.doc.captureSync();
    const index =
      typeof insertPosition === 'number'
        ? insertPosition
        : insertPositionToIndex(insertPosition, this._model.children);
    return this.doc.addBlock('affine:paragraph', {}, this._model.id, index);
  }

  rowDelete(ids: string[]): void {
    this.doc.captureSync();
    for (const id of ids) {
      const block = this.doc.getBlock(id);
      if (block) {
        this.doc.deleteBlock(block.model);
      }
    }
    deleteRows(this._model, ids);
  }

  rowMove(rowId: string, position: InsertToPosition): void {
    const model = this.doc.getModelById(rowId);
    if (model) {
      const index = insertPositionToIndex(position, this._model.children);
      const target = this._model.children[index];
      if (target?.id === rowId) {
        return;
      }
      this.doc.moveBlocks([model], this._model, target);
    }
  }

  viewDataAdd(viewData: DataViewDataType): string {
    this._model.store.captureSync();
    this._model.store.transact(() => {
      this._model.props.views = [...this._model.props.views, viewData];
    });
    return viewData.id;
  }

  viewDataDelete(viewId: string): void {
    this._model.store.captureSync();
    deleteView(this._model, viewId);
  }

  viewDataDuplicate(id: string): string {
    return duplicateView(this._model, id);
  }

  viewDataGet(viewId: string): DataViewDataType | undefined {
    return this.viewDataList$.value.find(data => data.id === viewId)!;
  }

  viewDataMoveTo(id: string, position: InsertToPosition): void {
    moveViewTo(this._model, id, position);
  }

  viewDataUpdate<ViewData extends DataViewDataType>(
    id: string,
    updater: (data: ViewData) => Partial<ViewData>
  ): void {
    updateView(this._model, id, updater);
  }

  viewMetaGet(type: string): ViewMeta {
    const view = databaseBlockViewMap[type];
    if (!view) {
      throw new BlockSuiteError(
        ErrorCode.DatabaseBlockError,
        `Unknown view type: ${type}`
      );
    }
    return view;
  }

  viewMetaGetById(viewId: string): ViewMeta | undefined {
    const view = this.viewDataGet(viewId);
    if (!view) {
      return;
    }
    return this.viewMetaGet(view.mode);
  }
}

export const databaseViewInitTemplate = (
  datasource: DatabaseBlockDataSource,
  viewType: string
) => {
  Array.from({ length: 3 }).forEach(() => {
    datasource.rowAdd('end');
  });
  datasource.viewManager.viewAdd(viewType);
};
export const convertToDatabase = (host: EditorHost, viewType: string) => {
  const [_, ctx] = host.std.command.exec(getSelectedModelsCommand, {
    types: ['block', 'text'],
  });
  const { selectedModels } = ctx;
  const firstModel = selectedModels?.[0];
  if (!firstModel) return;

  host.store.captureSync();

  const parentModel = host.store.getParent(firstModel);
  if (!parentModel) {
    return;
  }

  const id = host.store.addBlock(
    'affine:database',
    {},
    parentModel,
    parentModel.children.indexOf(firstModel)
  );
  const databaseModel = host.store.getBlock(id)?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) {
    return;
  }
  const datasource = new DatabaseBlockDataSource(databaseModel);
  datasource.viewManager.viewAdd(viewType);
  host.store.moveBlocks(selectedModels, databaseModel);

  const selectionManager = host.selection;
  selectionManager.clear();
};
