import { useI18n } from '@nota/i18n';

import { RenameSubMenu, type RenameSubMenuProps } from '../../../rename';

export const DocRenameSubMenu = ({
  title,
  text,
  ...props
}: RenameSubMenuProps) => {
  const t = useI18n();
  return (
    <RenameSubMenu
      title={title || t['com.affine.m.explorer.doc.rename']()}
      text={text || t['com.affine.m.explorer.doc.rename']()}
      {...props}
    />
  );
};
