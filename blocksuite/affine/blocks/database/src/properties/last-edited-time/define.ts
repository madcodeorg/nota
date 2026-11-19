import { propertyType, t } from '@blocksuite/data-view';
import { format } from 'date-fns/format';
import zod from 'zod';

type TimestampCandidate = number | null | undefined;

const toFiniteTimestamp = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const resolveLastEditedTimestamp = ({
  value,
  rowProps,
  docMeta,
}: {
  value?: unknown;
  rowProps?: {
    'meta:updatedAt'?: TimestampCandidate;
    'meta:createdAt'?: TimestampCandidate;
  };
  docMeta?: {
    updatedDate?: TimestampCandidate;
    createDate?: TimestampCandidate;
  };
}): number | null => {
  return (
    toFiniteTimestamp(value) ??
    toFiniteTimestamp(rowProps?.['meta:updatedAt']) ??
    toFiniteTimestamp(docMeta?.updatedDate) ??
    toFiniteTimestamp(rowProps?.['meta:createdAt']) ??
    toFiniteTimestamp(docMeta?.createDate)
  );
};

export const lastEditedTimeColumnType = propertyType('last-edited-time');

export const lastEditedTimePropertyModelConfig =
  lastEditedTimeColumnType.modelConfig({
    name: 'Last Edited Time',
    propertyData: {
      schema: zod.object({}),
      default: () => ({}),
    },
    jsonValue: {
      schema: zod.number().nullable(),
      isEmpty: ({ value }) => value == null,
      type: () => t.date.instance(),
    },
    rawValue: {
      schema: zod.number().nullable(),
      default: () => null,
      toString: ({ value }) =>
        value != null && Number.isFinite(value)
          ? format(value, 'yyyy-MM-dd HH:mm:ss')
          : '',
      fromString: () => {
        return { value: null };
      },
      toJson: ({ value, dataSource }) => {
        const doc = (
          dataSource as {
            doc?: { meta?: { updatedDate?: number; createDate?: number } };
          }
        )?.doc;
        return resolveLastEditedTimestamp({
          value,
          docMeta: doc?.meta,
        });
      },
      setValue: () => {},
    },
  });
