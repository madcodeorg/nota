import { MoreHorizontalIcon } from '@blocksuite/icons/rc';
import type { IconButtonProps } from '@nota/component/ui/button';
import { IconButton } from '@nota/component/ui/button';
import { forwardRef } from 'react';

import { headerMenuTrigger } from './styles.css';

export const HeaderDropDownButton = forwardRef<
  HTMLButtonElement,
  Omit<IconButtonProps, 'children'>
>((props, ref) => {
  return (
    <IconButton
      ref={ref}
      {...props}
      data-testid="header-dropDownButton"
      className={headerMenuTrigger}
    >
      <MoreHorizontalIcon />
    </IconButton>
  );
});

HeaderDropDownButton.displayName = 'HeaderDropDownButton';
