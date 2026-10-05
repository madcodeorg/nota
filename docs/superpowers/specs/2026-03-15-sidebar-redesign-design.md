# Nota Sidebar Redesign — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Simplify the app sidebar from 16 items/sections to a clean, minimal layout

---

## Overview

Redesign the Nota sidebar to reduce clutter and surface only essential navigation. Move secondary actions to a 2-row bottom icon tray. Rename core concepts to align with the Nota brand ("All Notes" instead of "All Pages").

## Current State

The sidebar currently has:

- Top fixed: Workspace Switcher, User Info, Quick Search + New Page, All Pages, Journal, Notifications, AI Chat, Settings
- Scrollable: Favorites, Organize, Migration Favorites, Tags, Collections, Others (Trash, Import, Invite, Templates, Learn More)
- Bottom fixed: Audio Player, Updater/Download button

**Problems:** Too many items visible at once, overlapping organization methods, rarely-used features taking prime real estate.

## New Layout

### Top Section (Fixed)

| Item                   | Behavior                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| **Workspace Switcher** | Unchanged. Dropdown with workspace list, cloud/sync status. Import moves into this dropdown menu. |
| **Search**             | Simplified nav item (no adjacent New Page button). Opens CMDK quick search.                       |
| **All Notes**          | Renamed from "All Pages". Inline `+` button on the right to create a new note.                    |
| **Intelligence**       | Renamed from "AI Chat". Links to `/chat`. Only visible when AI feature flag is enabled.           |

### Middle Section (Scrollable)

A single scrollable content area whose content is controlled by the active tab in the bottom tray:

- **Favorites tab active** → shows pinned docs, folders (replaces both old Favorites and Organize sections)
- **Collections tab active** → shows collections
- **Tags tab active** → shows tags

Only one tab is active at a time. Default: Favorites.

### Bottom Section (Fixed, 2-row icon tray)

**Row 1 — Content & Utility Icons (small):**

| Icon             | Action                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| ★ Favorites      | Toggles Favorites view in scrollable area (default active)                  |
| 🏷 Tags          | Toggles Tags view in scrollable area                                        |
| 📂 Collections   | Toggles Collections view in scrollable area                                 |
| 🗑 Trash         | Opens Trash view (`/trash`)                                                 |
| 🔔 Notifications | Opens notifications. Badge for unread count. Only shown when authenticated. |

**Row 2 — User & System Icons:**

| Icon                | Action                                                      |
| ------------------- | ----------------------------------------------------------- |
| User Avatar (large) | Opens account menu (cloud usage, AI usage, teams, sign out) |
| 📅 Journal          | Opens journal view (`/journals`)                            |
| ⚙ Settings          | Opens settings modal                                        |

## Items Removed

| Item                       | Where it goes                                            |
| -------------------------- | -------------------------------------------------------- |
| Import                     | Workspace Switcher dropdown menu                         |
| Invite Members             | Settings → Members                                       |
| Template Entrance          | "+" button menu (New Note → from template)               |
| Learn More / Blog          | Removed entirely                                         |
| Audio Player               | Removed from sidebar (still accessible from doc view)    |
| Updater button (Electron)  | Removed (rely on OS-level update notifications)          |
| App Download button (Web)  | Removed (desktop download handled by marketing site)     |
| Migration Favorites        | Removed (migration is complete for most users)           |
| Organize section           | Merged into Favorites (folders live inside favorites)    |
| `RootAppSidebarProps` type | Remove — unused dead code, component uses hooks/services |

## Component Changes

### Files to Modify

**`packages/frontend/core/src/components/root-app-sidebar/index.tsx`**

- Complete restructure of the `RootAppSidebar` component
- Remove: `QuickSearchInput`/`AddPageButton` wrapper div, `AllDocsButton`, `AIChatButton`, standalone `MenuItem` for Settings
- Add: `SearchNavItem`, `AllNotesNavItem` (with inline +), `IntelligenceNavItem`
- Replace `SidebarScrollableContainer` children with tab-controlled content
- Add new `BottomIconTray` component

**New component: `bottom-icon-tray.tsx`**

- 2-row layout component
- Row 1: Favorites/Tags/Collections tab buttons + Trash + Notifications
- Row 2: Avatar (large) + Journal + Settings
- Manages active tab state (which content shows in scrollable area)

**`packages/frontend/core/src/components/root-app-sidebar/index.css.ts`**

- Remove styles: `quickSearchAndNewPage`, `workspaceAndUserWrapper`, `workspaceWrapper`, `bottomContainer`
- Add styles: bottom tray layout, 2-row grid, active tab highlighting

**`packages/frontend/core/src/components/root-app-sidebar/user-info/`**

- Reuse existing `UserInfo` component and its subdirectory (`account.tsx`, `account-menu.tsx`, `ai-usage.tsx`, `cloud-usage.tsx`, `team-list.tsx`)
- Change avatar size from 20px → 32px in `AuthorizedUserInfo`
- Handle `UnauthorizedUserInfo` state in Row 2 (show sign-in icon instead of avatar)

**`packages/frontend/core/src/components/root-app-sidebar/journal-button.tsx`**

- Refactor from `MenuLinkItem` with text label → icon-only button for bottom tray

**`packages/frontend/core/src/components/root-app-sidebar/notification-button.tsx`**

- Adapt layout for bottom tray icon (keep badge behavior)

**`packages/frontend/core/src/components/root-app-sidebar/trash-button.tsx`**

- Refactor from collapsible section item → icon-only button for bottom tray

**Import logic relocation:**

- Move `handleOpenDocs` callback and `WorkspaceDialogService.open('import', ...)` call into the `WorkspaceNavigator` component or a shared service, since Import moves to the workspace dropdown

### Files to Remove or Deprecate

- `sidebar-audio-player.tsx` / `sidebar-audio-player.css.ts` — remove from sidebar
- `updater-button.tsx` — remove from sidebar
- `template-doc-entrance.tsx` — move to "+" menu
- `invite-members-button.tsx` — move to settings

### Files to Rename/Update

- `AllDocsButton` → `AllNotesNavItem` (rename + add inline `+` button)
- `AIChatButton` → `IntelligenceNavItem` (rename)
- i18n keys: `com.affine.workspaceSubPath.all` → update display text to "All Notes"
- i18n keys: `com.affine.workspaceSubPath.chat` → update display text to "Intelligence"

## State Management

### New State: Active Bottom Tab

```typescript
// In AppSidebar entity or a new SidebarNavigation entity
activeTab$: LiveData<'favorites' | 'collections' | 'tags'>;
// Default: 'favorites'
// Persisted to localStorage
```

### Tab Switching Logic

- Clicking a tab icon in Row 1 sets `activeTab$`
- The scrollable area renders the corresponding section based on `activeTab$`
- Active tab icon gets highlighted styling

## Visual Design Notes

- Bottom tray has subtle top border to separate from scrollable content
- Active tab icon uses primary brand color
- Avatar in Row 2 is ~32px (larger than current ~20px sidebar icons)
- Row 1 icons are ~20px, evenly spaced
- Row 2 has avatar left-aligned, Journal and Settings right-aligned
- Trash and Notifications are utility icons, visually de-emphasized compared to tab icons

## Edge Cases & Interaction Details

### Deep Linking

When navigating to a route like `/collections/abc123`, the sidebar should auto-switch to the Collections tab so the user sees their location context.

### Empty States

Each tab should show an appropriate empty state:

- Favorites: "Pin your favorite notes here" with a hint
- Collections: "No collections yet" with create button
- Tags: "No tags yet"

### Drag and Drop

Cross-tab drag-and-drop (e.g., dragging from Favorites to Collections) is intentionally dropped in this redesign. Users can still organize via right-click context menus or doc properties.

### Collapsed Sidebar

When sidebar is collapsed to icon strip, the bottom tray collapses to a single column of icons. The 32px avatar shrinks to match the collapsed width.

### Keyboard / Accessibility

Bottom tray Row 1 follows WAI-ARIA tablist pattern for Favorites/Collections/Tags. Trash and Notifications are standalone buttons, not tabs.

## Testing Considerations

- Verify tab switching persists across page navigation
- Verify tab state persists across sidebar collapse/expand
- Verify notifications badge still appears when authenticated
- Verify "+" button creates new doc correctly
- Verify Import is accessible from workspace dropdown
- Verify Invite Members is accessible from Settings
- Key E2E test files that need updates:
  - `tests/nota-local/e2e/all-page.spec.ts` — `data-testid="all-pages"` changes
  - `tests/nota-local/e2e/local-first-favorites-items.spec.ts` — favorites now tab-gated
  - `tests/nota-local/e2e/local-first-collections-items.spec.ts` — collections now tab-gated
  - `tests/nota-local/e2e/journal.spec.ts` — journal button moves to bottom tray
  - `tests/nota-local/e2e/import-dialog.spec.ts` — import button moves to workspace menu
  - `tests/nota-local/e2e/template.spec.ts` — template entrance removed from sidebar
