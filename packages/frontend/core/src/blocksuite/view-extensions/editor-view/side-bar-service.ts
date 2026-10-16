import { SidebarExtension } from '@blocksuite/affine/shared/services';
import { aiPanelSlot$ } from '@nota/core/components/root-app-sidebar/ai-panel-slot';
import { WorkbenchService } from '@nota/core/modules/workbench';
import type { FrameworkProvider } from '@nota/infra';

export function patchSideBarService(framework: FrameworkProvider) {
  const { workbench } = framework.get(WorkbenchService);

  return SidebarExtension({
    open: (tabId?: string) => {
      workbench.openSidebar(tabId);
      workbench.activeView$.value.activeSidebarTab(tabId ?? null);
    },
    close: () => {
      workbench.closeSidebar();
    },
    getTabIds: () => {
      const tabs = workbench.activeView$.value.sidebarTabs$.value.map(
        tab => tab.id
      );
      return aiPanelSlot$.value ? [...tabs, 'chat'] : tabs;
    },
  });
}
