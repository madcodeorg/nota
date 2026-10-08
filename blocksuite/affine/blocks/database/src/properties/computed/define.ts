import { propertyType, t } from '@blocksuite/data-view';
import zod from 'zod';

import { computedText, isComputedError } from './evaluate.js';

export const relationDataSchema = zod.object({
  targetDocId: zod.string(),
  targetDatabaseId: zod.string(),
});
export type RelationData = zod.infer<typeof relationDataSchema>;
export const formulaDataSchema = zod.object({
  expression: zod.string().max(4096),
  resultType: zod.enum(['number', 'string', 'boolean', 'date']),
});
export type FormulaData = zod.infer<typeof formulaDataSchema>;
export const rollupDataSchema = zod.object({
  relationColumnId: zod.string(),
  targetColumnId: zod.string(),
  operation: zod.enum([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'values',
    'unique',
  ]),
});
export type RollupData = zod.infer<typeof rollupDataSchema>;
export const relationValueSchema = zod.array(zod.string()).max(10000);

export const relationPropertyModelConfig = propertyType('relation').modelConfig(
  {
    name: 'Relation',
    propertyData: {
      schema: relationDataSchema,
      default: () => ({ targetDocId: '', targetDatabaseId: '' }),
    },
    jsonValue: {
      schema: relationValueSchema,
      type: () => t.array.instance(t.string.instance()),
      isEmpty: ({ value }) => !value?.length,
    },
    rawValue: {
      schema: relationValueSchema,
      default: () => [],
      toString: ({ value }) => JSON.stringify(value ?? []),
      fromString: ({ value }) => {
        try {
          const result = relationValueSchema.safeParse(JSON.parse(value));
          return { value: result.success ? result.data : [] };
        } catch {
          return { value: [] };
        }
      },
      toJson: ({ value }) => value ?? [],
      fromJson: ({ value }) => value,
      setValue: ({ newValue, setValue }) => {
        const result = relationValueSchema.safeParse(newValue);
        if (result.success) setValue([...new Set(result.data)]);
      },
    },
  }
);

const valueSchema = zod.union([
  zod.number().finite(),
  zod.string(),
  zod.boolean(),
  zod.null(),
  zod.array(zod.string()).max(10000),
  zod.object({ error: zod.string() }),
]);
const computedRawValue = {
  schema: valueSchema,
  default: () => null,
  toString: ({ value }: { value: unknown }) => computedText(value),
  fromString: () => ({ value: null }),
  toJson: ({ value }: { value: zod.infer<typeof valueSchema> }) =>
    isComputedError(value) ? null : value,
  // Results are derived, so paste/import cannot replace them.
  setValue: () => {},
};

export const formulaPropertyModelConfig = propertyType('formula').modelConfig({
  name: 'Formula',
  propertyData: {
    schema: formulaDataSchema,
    default: (): FormulaData => ({ expression: '', resultType: 'number' }),
  },
  jsonValue: {
    schema: zod.union([zod.number(), zod.string(), zod.boolean(), zod.null()]),
    type: ({ data }) =>
      data.resultType === 'date'
        ? t.date.instance()
        : data.resultType === 'boolean'
          ? t.boolean.instance()
          : data.resultType === 'string'
            ? t.string.instance()
            : t.number.instance(),
    isEmpty: ({ value }) => value == null || value === '',
  },
  rawValue: computedRawValue,
});

export const rollupPropertyModelConfig = propertyType('rollup').modelConfig({
  name: 'Rollup',
  propertyData: {
    schema: rollupDataSchema,
    default: (): RollupData => ({
      relationColumnId: '',
      targetColumnId: '',
      operation: 'count',
    }),
  },
  jsonValue: {
    schema: zod.union([zod.number(), zod.array(zod.string())]).nullable(),
    type: ({ data }) =>
      data.operation === 'values' || data.operation === 'unique'
        ? t.array.instance(t.string.instance())
        : t.number.instance(),
    isEmpty: ({ value }) =>
      value == null || (Array.isArray(value) && !value.length),
  },
  rawValue: {
    ...computedRawValue,
    toJson: ({ value }) =>
      typeof value === 'number' || Array.isArray(value) ? value : null,
  },
});
