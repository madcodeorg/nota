import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import { useService } from '@nota/infra';

import * as styles from './focus-mode-exit.css';

export const FocusModeExitButton = () => {
  const sidebar = useService(AppSidebarService).sidebar;
  return (
    <button
      type="button"
      className={styles.button}
      data-testid="focus-mode-exit"
      title="Exit focus mode (⌘⇧F)"
      onClick={() => sidebar.setFocusMode(false)}
    >
      Exit focus mode
    </button>
  );
};
