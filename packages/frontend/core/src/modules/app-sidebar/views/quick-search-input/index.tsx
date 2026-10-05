import { SearchIcon } from '@blocksuite/icons/rc';
import { useI18n } from '@nota/i18n';
import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

import * as styles from './index.css';

interface QuickSearchInputProps extends HTMLAttributes<HTMLDivElement> {
  onClick?: () => void;
}

// Although it is called an input, it is actually a button.
export function QuickSearchInput({ onClick, ...props }: QuickSearchInputProps) {
  const t = useI18n();

  return (
    <div
      {...props}
      className={clsx([props.className, styles.root])}
      onClick={onClick}
      tabIndex={0}
    >
      <SearchIcon className={styles.icon} />
      <span className={styles.quickSearchBarEllipsisStyle}>
        {t['Quick search']()}
      </span>
    </div>
  );
}
