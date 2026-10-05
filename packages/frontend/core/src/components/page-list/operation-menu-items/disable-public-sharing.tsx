import { ShareIcon } from '@blocksuite/icons/rc';
import type { MenuItemProps } from '@nota/component';
import { MenuItem } from '@nota/component';
import { useI18n } from '@nota/i18n';

export const DisablePublicSharing = (props: MenuItemProps) => {
  const t = useI18n();
  return (
    <MenuItem type="danger" prefixIcon={<ShareIcon />} {...props}>
      {t['Disable Public Sharing']()}
    </MenuItem>
  );
};
