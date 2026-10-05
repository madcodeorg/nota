import { ViewLayersIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@nota/component';
import { IsFavoriteIcon } from '@nota/core/components/pure/icons';
import type { CollectionMeta } from '@nota/core/modules/collection';
import { CompatibleFavoriteItemsAdapter } from '@nota/core/modules/favorite';
import { WorkbenchLink } from '@nota/core/modules/workbench';
import { useLiveData, useService } from '@nota/infra';
import { type MouseEvent, useCallback } from 'react';

import { item, name, prefixIcon, suffixIcon } from './styles.css';

export const CollectionListItem = ({ meta }: { meta: CollectionMeta }) => {
  const favAdapter = useService(CompatibleFavoriteItemsAdapter);

  const isFavorite = useLiveData(favAdapter.isFavorite$(meta.id, 'collection'));

  const toggle = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      favAdapter.toggle(meta.id, 'collection');
    },
    [favAdapter, meta.id]
  );

  return (
    <WorkbenchLink to={`/collection/${meta.id}`} className={item}>
      <ViewLayersIcon className={prefixIcon} />
      <span className={name}>{meta.title}</span>
      <IconButton
        className={suffixIcon}
        onClick={toggle}
        icon={<IsFavoriteIcon favorite={isFavorite} />}
        size="24"
      />
    </WorkbenchLink>
  );
};
