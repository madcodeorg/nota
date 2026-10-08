import type { WebContentsView } from 'electron';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
}));

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  BrowserWindow: class {},
  Menu: {},
  MenuItem: class {},
  WebContentsView: class {},
}));
vi.mock('@nota/i18n', () => ({ I18n: {} }));
vi.mock('../../src/shared/utils', () => ({ isMacOS: () => false }));
vi.mock('../../src/main/cleanup', () => ({
  beforeAppQuit: vi.fn(),
  onTabClose: vi.fn(),
}));
vi.mock('../../src/main/constants', () => ({
  mainWindowOrigin: 'assets://.',
  shellViewUrl: 'assets://./shell.html',
}));
vi.mock('../../src/main/helper-process', () => ({
  ensureHelperProcess: vi.fn(),
}));
vi.mock('../../src/main/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../src/main/shared-storage/storage', () => ({
  globalStateStorage: {
    get: (key: string) => mocks.storage.get(key),
    set: (key: string, value: unknown) => mocks.storage.set(key, value),
    watch: (key: string) => of(mocks.storage.get(key)),
  },
}));
vi.mock('../../src/main/windows-manager/main-window', () => ({
  MainWindowManager: {
    instance: {
      mainWindow: undefined,
      mainWindow$: new BehaviorSubject(undefined),
    },
  },
  getMainWindow: vi.fn(),
}));

const activeId = 'app-active';
const inactiveId = 'app-inactive';

function view(id: number, loading = false) {
  const webContents = {
    id,
    isLoadingMainFrame: vi.fn(() => loading),
    loadURL: vi.fn(async () => undefined),
  };
  return { webContents };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.storage.clear();
  mocks.storage.set('tabViewsMetaSchema', {
    activeWorkbenchId: activeId,
    workbenches: [activeId, inactiveId].map(id => ({
      id,
      basename: '/workspace/workspace-a',
      activeViewIndex: 0,
      views: [
        {
          id: `view-${id}`,
          path: { pathname: '/all', search: '?filter=recent', hash: '#last' },
        },
      ],
    })),
  });
});

async function managerWithViews(loading = false) {
  const module = await import('../../src/main/windows-manager/tab-views');
  const manager = module.WebContentViewsManager.instance;
  const active = view(101, loading);
  const inactive = view(102);
  manager.webViewsMap$.next(
    new Map([
      [activeId, active as unknown as WebContentsView],
      [inactiveId, inactive as unknown as WebContentsView],
    ])
  );
  manager.appTabsUIReady$.next(new Set());
  return { ...module, manager, active, inactive };
}

describe('retrying first-launch workspace entry', () => {
  test('reloads a stopped unready active tab and preserves its route', async () => {
    const { retryUnreadyActiveTab, manager, active, inactive } =
      await managerWithViews();
    await retryUnreadyActiveTab();
    expect(active.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(
      'assets://./workspace/workspace-a/all?filter=recent#last'
    );
    expect(inactive.webContents.loadURL).not.toHaveBeenCalled();
    expect(manager.tabViewsMap.size).toBe(2);
    expect(manager.tabViewsMap.get(activeId)).toBe(active);
  });

  test('does not interrupt a tab whose main frame is still loading', async () => {
    const { retryUnreadyActiveTab, active } = await managerWithViews(true);
    await retryUnreadyActiveTab();
    expect(active.webContents.isLoadingMainFrame).toHaveBeenCalledOnce();
    expect(active.webContents.loadURL).not.toHaveBeenCalled();
  });

  test('does not reload an interactive active tab', async () => {
    const { retryUnreadyActiveTab, manager, active } = await managerWithViews();
    manager.appTabsUIReady$.next(new Set([activeId]));
    await retryUnreadyActiveTab();
    expect(active.webContents.loadURL).not.toHaveBeenCalled();
    expect(active.webContents.isLoadingMainFrame).not.toHaveBeenCalled();
  });

  test('handles the absence of an active tab without creating a view', async () => {
    const { retryUnreadyActiveTab, active, inactive } =
      await managerWithViews();
    mocks.storage.set('tabViewsMetaSchema', { workbenches: [] });
    await retryUnreadyActiveTab();
    expect(active.webContents.loadURL).not.toHaveBeenCalled();
    expect(inactive.webContents.loadURL).not.toHaveBeenCalled();
  });

  test('entry waits for the retried active renderer rather than an inactive renderer', async () => {
    const {
      retryUnreadyActiveTab,
      waitForActiveTabUI,
      pingAppLayoutReady,
      active,
      inactive,
    } = await managerWithViews();
    await retryUnreadyActiveTab();
    let completed = false;
    const waiting = waitForActiveTabUI().then(() => {
      completed = true;
    });
    pingAppLayoutReady(inactive.webContents as never, true);
    await Promise.resolve();
    expect(completed).toBe(false);
    pingAppLayoutReady(active.webContents as never, true);
    await waiting;
    expect(completed).toBe(true);
  });
});
