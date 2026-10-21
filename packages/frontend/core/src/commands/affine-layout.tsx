import { ExpandFullIcon, SidebarIcon } from '@blocksuite/icons/rc';
import type { useI18n } from '@nota/i18n';
import { track } from '@nota/track';

import type { AppSidebarService } from '../modules/app-sidebar';
import { registerAffineCommand } from './registry';

export function registerAffineLayoutCommands({
  t,
  appSidebarService,
}: {
  t: ReturnType<typeof useI18n>;
  appSidebarService: AppSidebarService;
}) {
  const unsubs: Array<() => void> = [];
  unsubs.push(
    registerAffineCommand({
      id: 'affine:toggle-left-sidebar',
      category: 'nota:layout',
      icon: <SidebarIcon />,
      label: () =>
        appSidebarService.sidebar.open$.value
          ? t['com.affine.cmdk.affine.left-sidebar.collapse']()
          : t['com.affine.cmdk.affine.left-sidebar.expand'](),

      keyBinding: {
        binding: '$mod+/',
      },
      run() {
        track.$.navigationPanel.$.toggle({
          type: appSidebarService.sidebar.open$.value ? 'collapse' : 'expand',
        });
        appSidebarService.sidebar.toggleSidebar();
      },
    })
  );
  unsubs.push(
    registerAffineCommand({
      id: 'nota:toggle-focus-mode',
      category: 'nota:layout',
      icon: <ExpandFullIcon />,
      label: () =>
        appSidebarService.sidebar.focusMode$.value
          ? 'Exit focus mode'
          : 'Enter focus mode',
      keyBinding: {
        binding: '$mod+Shift+KeyF',
      },
      run() {
        appSidebarService.sidebar.toggleFocusMode();
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
