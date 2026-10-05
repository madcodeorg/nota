# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Nota sidebar from 16 items to a clean, minimal layout with a 2-row bottom icon tray.

**Architecture:** Restructure `RootAppSidebar` component. Remove clutter items (audio player, updater, blog link, etc.). Add a new `BottomIconTray` component with tab state that controls which section (Favorites/Collections/Tags) shows in the scrollable area. The tab state is stored as `activeTab$` in the `AppSidebar` entity, persisted to localStorage.

**Tech Stack:** React, vanilla-extract CSS, LiveData (from `@nota/infra`), existing sidebar component primitives (`MenuItem`, `MenuLinkItem`, `SidebarContainer`, `SidebarScrollableContainer`).

**Spec:** `docs/superpowers/specs/2026-03-15-sidebar-redesign-design.md`

---

## Chunk 1: State & Bottom Tray Foundation

### Task 1: Add `activeTab$` state to AppSidebar entity

**Files:**

- Modify: `packages/frontend/core/src/modules/app-sidebar/entities/app-sidebar.ts`
- Modify: `packages/frontend/core/src/modules/app-sidebar/providers/storage.ts` (if enum needed)

- [ ] **Step 1: Add activeTab state to AppSidebar entity**

In `packages/frontend/core/src/modules/app-sidebar/entities/app-sidebar.ts`, add:

```typescript
// Add to APP_SIDEBAR_STATE enum:
((ACTIVE_TAB = 'activeTab'),
  // Add to AppSidebar class:
  (activeTab$ = LiveData.from(this.appSidebarState.watch<'favorites' | 'collections' | 'tags'>(APP_SIDEBAR_STATE.ACTIVE_TAB).pipe(map(value => value ?? 'favorites')), this.appSidebarState.get<'favorites' | 'collections' | 'tags'>(APP_SIDEBAR_STATE.ACTIVE_TAB) ?? 'favorites')));

setActiveTab = (tab: 'favorites' | 'collections' | 'tags') => {
  this.appSidebarState.set(APP_SIDEBAR_STATE.ACTIVE_TAB, tab);
};
```

- [ ] **Step 2: Verify the entity compiles**

Run: `cd packages/frontend/core && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `app-sidebar.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/core/src/modules/app-sidebar/entities/app-sidebar.ts
git commit -m "feat(sidebar): add activeTab state to AppSidebar entity"
```

---

### Task 2: Update UserInfo to accept configurable size

**Files:**

- Modify: `packages/frontend/core/src/components/root-app-sidebar/user-info/index.tsx`

This must be done before creating BottomIconTray, which uses `<UserInfo size={32} />`.

- [ ] **Step 1: Add size prop to UserInfo**

In `packages/frontend/core/src/components/root-app-sidebar/user-info/index.tsx`, update:

```tsx
// Change the default export signature:
export default function UserInfo({ size = 20 }: { size?: number }) {
  const session = useService(AuthService).session;
  const account = useLiveData(session.account$);
  return account ? <AuthorizedUserInfo account={account} size={size} /> : <UnauthorizedUserInfo size={size} />;
}

// Update AuthorizedUserInfo — only change Avatar size, keep IconButton size as "20":
const AuthorizedUserInfo = ({ account, size }: { account: AuthAccountInfo; size: number }) => {
  return (
    <Menu items={<OperationMenu />} contentOptions={menuContentOptions}>
      <IconButton data-testid="sidebar-user-avatar" variant="plain" size="20" style={{ padding: 0, width: size, height: size }} withoutHover>
        <Avatar size={size} name={account.label} url={account.avatar} />
      </IconButton>
    </Menu>
  );
};

// Update UnauthorizedUserInfo:
const UnauthorizedUserInfo = ({ size }: { size: number }) => {
  const globalDialogService = useService(GlobalDialogService);
  const openSignInModal = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <IconButton onClick={openSignInModal} data-testid="sidebar-user-avatar" variant="plain" size="20" style={{ width: size, height: size }}>
      <UnknownUserIcon />
    </IconButton>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/core/src/components/root-app-sidebar/user-info/index.tsx
git commit -m "feat(sidebar): make UserInfo avatar size configurable"
```

---

### Task 3: Create BottomIconTray component

**Files:**

- Create: `packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.tsx`
- Create: `packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.css.ts`

- [ ] **Step 1: Create the CSS styles**

Create `packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.css.ts`:

```typescript
import { cssVarV2 } from '@nota/component/theme';
import { style } from '@vanilla-extract/css';

export const trayContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '8px 8px',
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const trayRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-evenly',
  gap: 4,
});

export const trayRow2 = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
});

export const avatarSection = style({
  flex: 1,
});

export const rightIcons = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});

export const trayIconButton = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: cssVarV2.icon.primary,
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
    '&[data-active="true"]': {
      color: cssVarV2.button.primary,
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const notificationDot = style({
  position: 'absolute',
  top: 2,
  right: 2,
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: cssVarV2.button.primary,
});
```

- [ ] **Step 2: Create the BottomIconTray component**

Create `packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.tsx`:

```tsx
import { DeleteIcon, FavoriteIcon, JournalIcon, NotificationIcon, SettingsIcon, TagIcon, ViewLayersIcon } from '@blocksuite/icons/rc';
import { Menu } from '@nota/component';
import { cssVarV2 } from '@nota/component/theme';
import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import { AuthService } from '@nota/core/modules/cloud';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { GlobalContextService } from '@nota/core/modules/global-context';
import { NotificationCountService } from '@nota/core/modules/notification';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService, useServices } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback } from 'react';

import { NotificationList } from '../notification/list';
import UserInfo from './user-info';
import * as styles from './bottom-icon-tray.css';

type SidebarTab = 'favorites' | 'collections' | 'tags';

export const BottomIconTray = () => {
  const t = useI18n();
  const { appSidebarService, workbenchService, authService } = useServices({
    AppSidebarService,
    WorkbenchService,
    AuthService,
  });

  const sidebar = appSidebarService.sidebar;
  const workbench = workbenchService.workbench;
  const activeTab = useLiveData(sidebar.activeTab$);
  const sessionStatus = useLiveData(authService.session.status$);
  const globalContextService = useService(GlobalContextService);
  const trashActive = useLiveData(globalContextService.globalContext.isTrash.$);
  const workspaceDialogService = useService(WorkspaceDialogService);

  const setTab = useCallback(
    (tab: SidebarTab) => {
      sidebar.setActiveTab(tab);
    },
    [sidebar]
  );

  const onOpenSettings = useCallback(() => {
    workspaceDialogService.open('setting', { activeTab: 'appearance' });
    track.$.navigationPanel.$.openSettings();
  }, [workspaceDialogService]);

  const location = useLiveData(workbench.location$);
  const isJournal = location.pathname.startsWith('/journals');

  return (
    <div className={styles.trayContainer}>
      {/* Row 1: Tab icons + utility icons */}
      <div className={styles.trayRow} role="tablist" aria-label="Sidebar sections">
        <button className={styles.trayIconButton} data-active={activeTab === 'favorites'} data-testid="sidebar-tab-favorites" role="tab" aria-selected={activeTab === 'favorites'} onClick={() => setTab('favorites')} title={t['com.affine.rootAppSidebar.favorites']()}>
          <FavoriteIcon />
        </button>
        <button className={styles.trayIconButton} data-active={activeTab === 'tags'} data-testid="sidebar-tab-tags" role="tab" aria-selected={activeTab === 'tags'} onClick={() => setTab('tags')} title={t['Tags']()}>
          <TagIcon />
        </button>
        <button className={styles.trayIconButton} data-active={activeTab === 'collections'} data-testid="sidebar-tab-collections" role="tab" aria-selected={activeTab === 'collections'} onClick={() => setTab('collections')} title={t['com.affine.collections.header']()}>
          <ViewLayersIcon />
        </button>
        <button className={styles.trayIconButton} data-active={trashActive} data-testid="sidebar-tray-trash" onClick={() => workbench.open('/trash')} title={t['com.affine.workspaceSubPath.trash']()}>
          <DeleteIcon />
        </button>
        {sessionStatus === 'authenticated' && <TrayNotificationButton />}
      </div>

      {/* Row 2: Avatar, Journal, Settings */}
      <div className={styles.trayRow2}>
        <div className={styles.avatarSection}>
          <UserInfo size={32} />
        </div>
        <div className={styles.rightIcons}>
          <button className={styles.trayIconButton} data-active={isJournal} data-testid="sidebar-tray-journal" onClick={() => workbench.open('/journals')} title={t['com.affine.journal.app-sidebar-title']()}>
            <JournalIcon />
          </button>
          <button className={styles.trayIconButton} data-testid="sidebar-tray-settings" onClick={onOpenSettings} title={t['com.affine.settingSidebar.title']()}>
            <SettingsIcon />
          </button>
        </div>
      </div>
    </div>
  );
};

const TrayNotificationButton = () => {
  const notificationCountService = useService(NotificationCountService);
  const notificationCount = useLiveData(notificationCountService.count$);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        track.$.sidebar.notifications.openInbox({
          unreadCount: notificationCountService.count$.value,
        });
      }
    },
    [notificationCountService.count$]
  );

  return (
    <Menu rootOptions={{ onOpenChange: handleOpenChange }} contentOptions={{ side: 'top', sideOffset: 8 }} items={<NotificationList />}>
      <button className={styles.trayIconButton} data-testid="sidebar-tray-notifications" title="Notifications">
        <NotificationIcon />
        {notificationCount > 0 && <span className={styles.notificationDot} />}
      </button>
    </Menu>
  );
};
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/frontend/core && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.tsx packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.css.ts
git commit -m "feat(sidebar): create BottomIconTray component"
```

---

## Chunk 2: Restructure RootAppSidebar

### Task 4: Restructure the main sidebar component

**Files:**

- Modify: `packages/frontend/core/src/components/root-app-sidebar/index.tsx`
- Modify: `packages/frontend/core/src/components/root-app-sidebar/index.css.ts`

This is the main task. We completely rewrite the `RootAppSidebar` render output.

- [ ] **Step 1: Update index.css.ts**

Replace the contents of `packages/frontend/core/src/components/root-app-sidebar/index.css.ts` with:

```typescript
import { style } from '@vanilla-extract/css';

export const workspaceWrapper = style({
  display: 'flex',
  alignItems: 'center',
  width: 'calc(100% + 12px)',
  height: 42,
  alignSelf: 'center',
});

export const allNotesRow = style({
  display: 'flex',
  alignItems: 'center',
});

export const allNotesLink = style({
  flex: 1,
  minWidth: 0,
});

export const newNoteButton = style({
  flexShrink: 0,
});
```

- [ ] **Step 2: Rewrite index.tsx**

Replace the contents of `packages/frontend/core/src/components/root-app-sidebar/index.tsx`:

```tsx
import { AiOutlineIcon, AllDocsIcon, SearchIcon } from '@blocksuite/icons/rc';
import { AddPageButton, AppSidebar, MenuItem, MenuLinkItem, SidebarContainer, SidebarScrollableContainer } from '@nota/core/modules/app-sidebar/views';
import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import { ServerService } from '@nota/core/modules/cloud';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { CMDKQuickSearchService } from '@nota/core/modules/quicksearch/services/cmdk';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import type { ReactElement } from 'react';
import { memo, useCallback } from 'react';

import { NavigationPanelCollections, NavigationPanelFavorites, NavigationPanelTags } from '../../desktop/components/navigation-panel';
import { WorkbenchService } from '../../modules/workbench';
import { WorkspaceNavigator } from '../workspace-selector';
import { BottomIconTray } from './bottom-icon-tray';
import * as styles from './index.css';

const SearchNavItem = () => {
  const t = useI18n();
  const cMDKQuickSearchService = useService(CMDKQuickSearchService);

  const onOpenQuickSearch = useCallback(() => {
    cMDKQuickSearchService.toggle();
  }, [cMDKQuickSearchService]);

  return (
    <MenuItem data-testid="slider-bar-quick-search-button" data-event-props="$.navigationPanel.$.quickSearch" icon={<SearchIcon />} onClick={onOpenQuickSearch}>
      {t['Quick search']()}
    </MenuItem>
  );
};

const AllNotesNavItem = () => {
  const t = useI18n();
  const workbench = useService(WorkbenchService).workbench;
  const allPageActive = useLiveData(workbench.location$.selector(location => location.pathname === '/all'));

  return (
    <div className={styles.allNotesRow}>
      <div className={styles.allNotesLink}>
        <MenuLinkItem icon={<AllDocsIcon />} active={allPageActive} to={'/all'}>
          <span data-testid="all-pages">{t['com.affine.workspaceSubPath.all']()}</span>
        </MenuLinkItem>
      </div>
      <AddPageButton className={styles.newNoteButton} />
    </div>
  );
};

const IntelligenceNavItem = () => {
  const t = useI18n();
  const featureFlagService = useService(FeatureFlagService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);
  const workbench = useService(WorkbenchService).workbench;
  const aiChatActive = useLiveData(workbench.location$.selector(location => location.pathname === '/chat'));

  if (!enableAI || !serverFeatures?.copilot) {
    return null;
  }

  return (
    <MenuLinkItem icon={<AiOutlineIcon />} active={aiChatActive} to={'/chat'}>
      <span data-testid="ai-chat">{t['com.affine.workspaceSubPath.chat']()}</span>
    </MenuLinkItem>
  );
};

const TabContent = () => {
  const appSidebarService = useService(AppSidebarService);
  const activeTab = useLiveData(appSidebarService.sidebar.activeTab$);

  return (
    <div role="tabpanel" aria-label={activeTab}>
      {activeTab === 'favorites' && <NavigationPanelFavorites />}
      {activeTab === 'collections' && <NavigationPanelCollections />}
      {activeTab === 'tags' && <NavigationPanelTags />}
    </div>
  );
};

export const RootAppSidebar = memo((): ReactElement => {
  const workbench = useService(WorkbenchService).workbench;
  const workspaceSelectorOpen = useLiveData(workbench.workspaceSelectorOpen$);

  const onWorkspaceSelectorOpenChange = useCallback(
    (open: boolean) => {
      workbench.setWorkspaceSelectorOpen(open);
    },
    [workbench]
  );

  return (
    <AppSidebar>
      <SidebarContainer>
        <div className={styles.workspaceWrapper}>
          <WorkspaceNavigator showEnableCloudButton showSyncStatus open={workspaceSelectorOpen} onOpenChange={onWorkspaceSelectorOpenChange} dense />
        </div>
        <SearchNavItem />
        <AllNotesNavItem />
        <IntelligenceNavItem />
      </SidebarContainer>
      <SidebarScrollableContainer>
        <TabContent />
      </SidebarScrollableContainer>
      <BottomIconTray />
    </AppSidebar>
  );
});

RootAppSidebar.displayName = 'memo(RootAppSidebar)';
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/frontend/core && npx tsc --noEmit --pretty 2>&1 | head -50`

- [ ] **Step 4: Fix any import/type errors**

The component uses `AppSidebarService` — verify the import path is correct by checking:
`packages/frontend/core/src/modules/app-sidebar/index.ts`

Note: The workbench entity uses `workbench.open(path)` for navigation — NOT `openPage()` or `openTrash()`. The BottomIconTray already uses `workbench.open('/trash')` and `workbench.open('/journals')` correctly.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/core/src/components/root-app-sidebar/index.tsx packages/frontend/core/src/components/root-app-sidebar/index.css.ts
git commit -m "feat(sidebar): restructure RootAppSidebar with new minimal layout"
```

---

## Chunk 3: i18n Updates & Cleanup

### Task 5: Update i18n display text

**Files:**

- Modify: `packages/frontend/i18n/src/resources/en.json`

- [ ] **Step 1: Update English i18n keys**

In `packages/frontend/i18n/src/resources/en.json`, find and update:

```json
"com.affine.workspaceSubPath.all": "All Notes"
"com.affine.workspaceSubPath.chat": "Intelligence"
```

Note: Keep the key names unchanged (they use `affine` prefix which is an i18n convention, not a brand reference). Only change the display value.

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/i18n/src/resources/en.json
git commit -m "feat(sidebar): rename 'All Pages' to 'All Notes' and 'AI Chat' to 'Intelligence'"
```

---

### Task 6: Remove unused sidebar components from imports

**Files:**

- Modify: `packages/frontend/core/src/components/root-app-sidebar/index.tsx` (verify no dead imports)

The following files are no longer imported by `index.tsx` and can be left in place for now (they may be used by mobile or other entry points). Verify they are truly unused:

- `sidebar-audio-player.tsx` — was only used in `index.tsx` bottom section
- `updater-button.tsx` — was only used in `index.tsx` bottom section
- `template-doc-entrance.tsx` — was only used in `index.tsx` Others section
- `invite-members-button.tsx` — was only used in `index.tsx` Others section
- `journal-button.tsx` — was only used in `index.tsx` top section (now replaced by icon in tray)
- `notification-button.tsx` — functionality moved inline to `bottom-icon-tray.tsx`
- `trash-button.tsx` — functionality moved inline to `bottom-icon-tray.tsx`

- [ ] **Step 1: Search for other usages of each removed component**

For each file, grep the codebase to check if it's imported anywhere else:

```bash
rg "sidebar-audio-player" --type ts --type tsx -l
rg "updater-button" --type ts --type tsx -l
rg "template-doc-entrance" --type ts --type tsx -l
rg "invite-members-button" --type ts --type tsx -l
rg "journal-button" --type ts --type tsx -l
rg "notification-button" --type ts --type tsx -l
rg "trash-button" --type ts --type tsx -l
```

- [ ] **Step 2: Delete files that are only used by the old sidebar**

For each file that has no other consumers, delete it:

```bash
git rm <file>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(sidebar): remove unused sidebar components"
```

---

### Task 7: Remove unused RootAppSidebarProps type and old code

**Files:**

- Modify: `packages/frontend/core/src/components/root-app-sidebar/index.tsx`

- [ ] **Step 1: Verify RootAppSidebarProps is not used anywhere**

```bash
rg "RootAppSidebarProps" --type ts --type tsx -l
```

If it was already removed in Task 4, skip this task.

- [ ] **Step 2: Commit if changes were needed**

---

## Chunk 4: Deep Linking & Polish

### Task 8: Auto-switch tab on route navigation

**Files:**

- Modify: `packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.tsx` or `index.tsx`

- [ ] **Step 1: Add route-based tab auto-switching**

In `bottom-icon-tray.tsx`, add a `useEffect` that watches the workbench location and switches tabs:

```tsx
import { useEffect } from 'react';

// Inside BottomIconTray component, after getting location:
useEffect(() => {
  const path = location.pathname;
  if (path.startsWith('/collection')) {
    sidebar.setActiveTab('collections');
  } else if (path.startsWith('/tag')) {
    sidebar.setActiveTab('tags');
  }
  // Don't auto-switch to favorites — it's the default and
  // we don't want navigating to a doc to switch away from current tab
}, [location.pathname, sidebar]);
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/core/src/components/root-app-sidebar/bottom-icon-tray.tsx
git commit -m "feat(sidebar): auto-switch tab on collection/tag navigation"
```

---

### Task 9: Relocate Import to workspace dropdown

**Files:**

- Modify: `packages/frontend/core/src/components/workspace-selector/index.tsx` (or the workspace dropdown menu component)

The Import action was removed from the sidebar. It needs to be accessible from the workspace switcher dropdown.

- [ ] **Step 1: Find the workspace dropdown menu component**

```bash
# Find where WorkspaceNavigator renders its dropdown menu
rg "WorkspaceNavigator" packages/frontend/core/src/components/workspace-selector/ -l
```

- [ ] **Step 2: Add an Import menu item to the workspace dropdown**

Add an Import option to the workspace dropdown menu. Reuse the existing import dialog logic:

```tsx
import { ImportIcon } from '@blocksuite/icons/rc';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';

// Inside the dropdown menu items:
const onOpenImportModal = useCallback(() => {
  track.$.navigationPanel.importModal.open();
  workspaceDialogService.open('import', undefined, payload => {
    if (!payload) return;
    const { docIds, entryId, isWorkspaceFile } = payload;
    if (isWorkspaceFile && entryId) {
      workbench.openDoc(entryId);
    } else if (docIds.length > 1) {
      workbench.openAll();
    } else if (docIds.length === 1) {
      workbench.openDoc(docIds[0]);
    }
  });
}, [workspaceDialogService, workbench]);

<MenuItem prefixIcon={<ImportIcon />} onClick={onOpenImportModal}>
  {t['Import']()}
</MenuItem>;
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/core/src/components/workspace-selector/
git commit -m "feat(sidebar): relocate Import to workspace dropdown menu"
```

---

### Task 10: Manual testing & visual verification

- [ ] **Step 1: Start dev server**

```bash
yarn dev
```

- [ ] **Step 2: Verify sidebar layout**

Check these in the browser:

1. Workspace switcher shows at top
2. Search, All Notes (with + button), Intelligence show below
3. Scrollable area shows Favorites by default
4. Bottom tray shows 2 rows of icons
5. Clicking Tags/Collections/Favorites tabs switches scrollable content
6. Avatar (32px) shows in bottom-left, opens account menu
7. Journal and Settings icons work in bottom-right
8. Trash icon navigates to /trash
9. Notification icon shows with badge when logged in

- [ ] **Step 3: Test collapsed sidebar**

1. Collapse sidebar
2. Verify bottom tray still renders sensibly
3. Expand sidebar — verify tab state persisted

- [ ] **Step 4: Fix any visual issues found**

---

### Task 11: Update E2E test selectors

**Files:**

- Modify: `tests/nota-local/e2e/all-page.spec.ts`
- Modify: `tests/nota-local/e2e/local-first-favorites-items.spec.ts`
- Modify: `tests/nota-local/e2e/local-first-collections-items.spec.ts`
- Modify: `tests/nota-local/e2e/journal.spec.ts`
- Modify: `tests/nota-local/e2e/import-dialog.spec.ts`
- Modify: `tests/nota-local/e2e/template.spec.ts`

- [ ] **Step 1: Update test selectors to match new sidebar**

Key changes:

- Tests that click `slider-bar-journals-button` → update to find journal icon in bottom tray
- Tests that click `slider-bar-import-button` → update to find import in workspace menu
- Tests that click `slider-bar-workspace-setting-button` → update to find settings in bottom tray
- Tests that interact with favorites/collections → may need to click tab first
- Tests that reference `sidebar-template-doc-entrance` → update to use + menu

- [ ] **Step 2: Run E2E tests**

```bash
yarn test:e2e -- --grep "sidebar"
```

- [ ] **Step 3: Fix failing tests**

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test(sidebar): update E2E selectors for new sidebar layout"
```

---

### Task 12: Final commit & cleanup

- [ ] **Step 1: Run full type check**

```bash
cd packages/frontend/core && npx tsc --noEmit
```

- [ ] **Step 2: Run linter**

```bash
yarn lint
```

- [ ] **Step 3: Fix any issues and commit**

```bash
git commit -m "chore(sidebar): fix lint and type errors from sidebar redesign"
```
