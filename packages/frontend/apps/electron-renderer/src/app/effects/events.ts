import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import type { SettingTab } from '@nota/core/modules/dialogs/constant';
import { DocsService } from '@nota/core/modules/doc';
import { JournalService } from '@nota/core/modules/journal';
import { LifecycleService } from '@nota/core/modules/lifecycle';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { apis, events } from '@nota/electron-api';
import type { FrameworkProvider } from '@nota/infra';

import { setupRecordingEvents } from './recording';
import { getCurrentWorkspace } from './utils';

let pendingMeetingIntent: { start?: boolean; stop?: boolean } | null = null;
let pendingMeetingIntentTimer: number | null = null;

function openPendingMeetingIntent(frameworkProvider: FrameworkProvider) {
  const intent = pendingMeetingIntent;
  if (!intent) {
    return;
  }
  using currentWorkspace = getCurrentWorkspace(frameworkProvider);
  if (!currentWorkspace) {
    pendingMeetingIntentTimer ??= window.setTimeout(() => {
      pendingMeetingIntentTimer = null;
      openPendingMeetingIntent(frameworkProvider);
    }, 250);
    return;
  }

  pendingMeetingIntent = null;
  if (pendingMeetingIntentTimer !== null) {
    window.clearTimeout(pendingMeetingIntentTimer);
    pendingMeetingIntentTimer = null;
  }
  const { workspace, dispose } = currentWorkspace;
  const workbench = workspace.scope.get(WorkbenchService).workbench;
  const params = new URLSearchParams();
  if (intent.start) {
    params.set('new', '1');
    params.set('start', '1');
    params.set('intent', Date.now().toString());
  } else if (intent.stop) {
    params.set('stop', '1');
    params.set('intent', Date.now().toString());
  }
  const search = params.toString();
  workbench.open(
    {
      pathname: '/meetings',
      search: search ? `?${search}` : '',
    },
    { at: 'active' }
  );
  dispose();
}

export function setupEvents(frameworkProvider: FrameworkProvider) {
  // setup application lifecycle events, and emit application start event
  window.addEventListener('focus', () => {
    frameworkProvider.get(LifecycleService).applicationFocus();
  });
  frameworkProvider.get(LifecycleService).applicationStart();

  events?.applicationMenu.openInSettingModal(({ activeTab, scrollAnchor }) => {
    using currentWorkspace = getCurrentWorkspace(frameworkProvider);
    if (!currentWorkspace) {
      return;
    }
    const { workspace } = currentWorkspace;
    const workspaceDialogService = workspace.scope.get(WorkspaceDialogService);
    // close all other dialogs first
    workspaceDialogService.closeAll();
    workspaceDialogService.open('setting', {
      activeTab: activeTab as unknown as SettingTab,
      scrollAnchor,
    });
  });

  events?.applicationMenu.onNewPageAction(type => {
    apis?.ui
      .isActiveTab()
      .then(isActive => {
        if (!isActive) {
          return;
        }
        using currentWorkspace = getCurrentWorkspace(frameworkProvider);
        if (!currentWorkspace) {
          return;
        }
        const { workspace } = currentWorkspace;
        const docsService = workspace.scope.get(DocsService);

        const page = docsService.createDoc({ primaryMode: type });
        workspace.scope.get(WorkbenchService).workbench.openDoc(page.id);
      })
      .catch(err => {
        console.error(err);
      });
  });

  events?.applicationMenu.onOpenJournal(() => {
    using currentWorkspace = getCurrentWorkspace(frameworkProvider);
    if (!currentWorkspace) {
      return;
    }
    const { workspace, dispose } = currentWorkspace;

    const workbench = workspace.scope.get(WorkbenchService).workbench;
    const journalService = workspace.scope.get(JournalService);
    const docId = journalService.ensureJournalByDate(new Date()).id;
    workbench.openDoc(docId);

    dispose();
  });

  events?.applicationMenu.onOpenMeetingsPage((intent = {}) => {
    // The main-process calendar scheduler can fire while the desktop window is
    // still restoring its workspace. Keep the latest intent until a workspace
    // exists instead of silently dropping an auto-start or explicit Stop.
    pendingMeetingIntent = intent;
    openPendingMeetingIntent(frameworkProvider);
  });

  setupRecordingEvents(frameworkProvider);
}
