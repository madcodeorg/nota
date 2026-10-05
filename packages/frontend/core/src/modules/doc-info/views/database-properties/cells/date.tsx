import { DateValue } from '@nota/core/components/workspace-property-types/date';
import type { LiveData } from '@nota/infra';
import { useLiveData } from '@nota/infra';
import dayjs from 'dayjs';

import type { DatabaseCellRendererProps } from '../../../types';

const toInternalDateString = (date: unknown) => {
  if (typeof date !== 'string' && typeof date !== 'number') {
    return '';
  }
  return dayjs(date).format('YYYY-MM-DD');
};

const fromInternalDateString = (date: string) => {
  return dayjs(date).toDate().getTime();
};

export const DateCell = ({
  cell,
  rowId,
  dataSource,
  onChange,
}: DatabaseCellRendererProps) => {
  const value = useLiveData(
    cell.value$ as LiveData<number | string | undefined>
  );
  const date = value ? toInternalDateString(value) : '';
  return (
    <DateValue
      value={date}
      onChange={v => {
        dataSource.cellValueChange(
          rowId,
          cell.property.id,
          fromInternalDateString(v)
        );
        onChange?.(fromInternalDateString(v));
      }}
    />
  );
};
