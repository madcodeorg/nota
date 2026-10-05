import { MenuItem } from '@nota/component';
import { CompatibleFavoriteItemsAdapter } from '@nota/core/modules/favorite';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { useMemo } from 'react';
import { RiStarFill, RiStarLine } from 'react-icons/ri';

export const FavoriteFolderOperation = ({ id }: { id: string }) => {
  const t = useI18n();
  const compatibleFavoriteItemsAdapter = useService(
    CompatibleFavoriteItemsAdapter
  );

  const favorite = useLiveData(
    useMemo(() => {
      return compatibleFavoriteItemsAdapter.isFavorite$(id, 'folder');
    }, [compatibleFavoriteItemsAdapter, id])
  );

  return (
    <MenuItem
      prefixIcon={
        favorite ? <RiStarFill size={18} /> : <RiStarLine size={18} />
      }
      onClick={() => compatibleFavoriteItemsAdapter.toggle(id, 'folder')}
    >
      {favorite
        ? t['com.affine.rootAppSidebar.organize.folder-rm-favorite']()
        : t['com.affine.rootAppSidebar.organize.folder-add-favorite']()}
    </MenuItem>
  );
};
