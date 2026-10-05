import type { SyntheticEvent } from 'react';

import * as styles from './index.css';

export const UserAccountItem = ({
  email,
}: {
  email: string;
  onClick: (e: SyntheticEvent<Element, Event>) => void;
  onEventEnd?: () => void;
}) => {
  return (
    <div className={styles.userAccountContainer}>
      <div className={styles.leftContainer}>
        <div className={styles.userEmail}>{email}</div>
      </div>
    </div>
  );
};
