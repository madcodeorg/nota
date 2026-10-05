import { NumberValue } from '@nota/core/components/workspace-property-types/number';
import { useLiveData } from '@nota/infra';

import type { DatabaseCellRendererProps } from '../../../types';

export const NumberCell = ({
  cell,
  rowId,
  dataSource,
  onChange,
}: DatabaseCellRendererProps) => {
  const value = useLiveData(cell.value$);
  return (
    <NumberValue
      value={value}
      onChange={v => {
        const value = Number(v);
        if (isNaN(value)) {
          return;
        }
        dataSource.cellValueChange(rowId, cell.property.id, value);
        onChange?.(v);
      }}
    />
  );
};
