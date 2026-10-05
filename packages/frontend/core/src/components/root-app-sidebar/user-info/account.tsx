import { Avatar } from '@nota/component';
import { useAccountDisplay } from '@nota/core/components/hooks/use-account-display';

import * as styles from './index.css';

export const Account = () => {
  const account = useAccountDisplay();
  if (!account) {
    // TODO(@JimmFly): loading ui
    return null;
  }
  return (
    <div data-testid="user-info-card" className={styles.account}>
      <Avatar size={28} rounded={50} name={account.name} url={account.avatar} />

      <div className={styles.content}>
        <div
          className={styles.name}
          title={account.name}
          content={account.name}
        >
          {account.name}
        </div>
        {account.email ? (
          <div
            className={styles.email}
            title={account.email}
            content={account.email}
          >
            {account.email}
          </div>
        ) : null}
      </div>
    </div>
  );
};
