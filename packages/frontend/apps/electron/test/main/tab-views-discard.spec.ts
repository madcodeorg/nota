import type { WebContentsView } from 'electron';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  recording: { status: null as { status: string } | null },
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
vi.mock('../../src/main/recording/state-machine', () => ({
  recordingStateMachine: mocks.recording,
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
const idleId = 'app-idle';

function fakeView(id: number) {
  const state = { loading: false, audible: false, destroyed: false };
  const listeners = new Map<string, () => void>();
  const webContents = {
    id,
    isDestroyed: vi.fn(() => state.destroyed),
    isLoading: vi.fn(() => state.loading),
    isLoadingMainFrame: vi.fn(() => state.loading),
    isCurrentlyAudible: vi.fn(() => state.audible),
    setBackgroundThrottling: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    close: vi.fn(),
    once: vi.fn((event: string, fn: () => void) => listeners.set(event, fn)),
  };
  return { webContents, state, listeners };
}

type FakeView = ReturnType<typeof fakeView>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  mocks.storage.clear();
  mocks.recording.status = null;
  mocks.storage.set('tabViewsMetaSchema', {
    activeWorkbenchId: activeId,
    workbenches: [activeId, idleId].map(id => ({
      id,
      basename: '/workspace/workspace-a',
      activeViewIndex: 0,
      views: [{ id: `view-${id}`, path: { pathname: '/all' } }],
    })),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const module = await import('../../src/main/windows-manager/tab-views');
  const manager = module.WebContentViewsManager.instance;
  const shell = fakeView(100);
  const active = fakeView(101);
  const idle = fakeView(102);
  manager.webViewsMap$.next(
    new Map([
      ['shell', shell as unknown as WebContentsView],
      [activeId, active as unknown as WebContentsView],
      [idleId, idle as unknown as WebContentsView],
    ])
  );
  manager.appTabsUIReady$.next(new Set([activeId, idleId]));
  // views are normally wrapped by WebContentsView, which exposes webContents
  await manager.showTab(activeId);
  return { ...module, manager, shell, active, idle };
}

function patchWorkbench(id: string, patch: Record<string, unknown>) {
  const meta = mocks.storage.get('tabViewsMetaSchema') as {
    workbenches: { id: string }[];
  };
  mocks.storage.set('tabViewsMetaSchema', {
    ...meta,
    workbenches: meta.workbenches.map(w =>
      w.id === id ? { ...w, ...patch } : w
    ),
  });
}

describe('tab discarding', () => {
  test('discards an idle inactive tab but keeps its metadata and strip entry', async () => {
    const { manager, idle, active, shell, TAB_DISCARD_IDLE_MS } = await setup();

    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS - 1);
    expect(idle.webContents.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(idle.webContents.close).toHaveBeenCalledExactlyOnceWith({
      waitForBeforeUnload: true,
    });
    expect(active.webContents.close).not.toHaveBeenCalled();
    expect(shell.webContents.close).not.toHaveBeenCalled();
    expect([...manager.tabViewsMap.keys()]).toEqual(['shell', activeId]);

    const tabs = await firstValueFrom(manager.tabsStatus$);
    expect(tabs.find(t => t.id === idleId)).toMatchObject({
      loaded: false,
      ready: false,
    });
    expect(tabs.find(t => t.id === activeId)).toMatchObject({ loaded: true });
    expect(manager.tabViewsMeta.workbenches.map(w => w.id)).toEqual([
      activeId,
      idleId,
    ]);
  });

  test('showTab recreates a discarded tab at its last saved path', async () => {
    const { manager, idle, TAB_DISCARD_IDLE_MS } = await setup();
    manager.updateWorkbenchViewMeta(idleId, 0, {
      path: { pathname: '/doc/abc', search: '?q=1', hash: '#h' },
    });
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS);
    expect(manager.tabViewsMap.has(idleId)).toBe(false);

    const recreated = fakeView(103);
    const createAndAddView = vi.fn(async (_type: string, id: string) => {
      manager.webViewsMap$.next(
        new Map(manager.tabViewsMap).set(
          id,
          recreated as unknown as WebContentsView
        )
      );
      return recreated;
    });
    (manager as any).createAndAddView = createAndAddView;

    await manager.showTab(idleId);

    expect(createAndAddView).toHaveBeenCalledExactlyOnceWith('app', idleId);
    expect(recreated.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(
      'assets://./workspace/workspace-a/doc/abc?q=1#h'
    );
    expect(idle.webContents.loadURL).not.toHaveBeenCalled();
    expect(manager.activeWorkbenchId).toBe(idleId);
  });

  test('a reactivated tab restarts its idle period', async () => {
    const { manager, idle, TAB_DISCARD_IDLE_MS } = await setup();
    const minute = 60 * 1000;

    await vi.advanceTimersByTimeAsync(9 * minute);
    await manager.showTab(idleId);
    await manager.showTab(activeId);
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS - minute);
    expect(idle.webContents.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(minute);
    expect(idle.webContents.close).toHaveBeenCalledOnce();
  });

  test('never discards the active tab', async () => {
    const { manager, active, idle, TAB_DISCARD_IDLE_MS } = await setup();
    await manager.showTab(idleId);
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS * 3);
    expect(idle.webContents.close).not.toHaveBeenCalled();
    expect(active.webContents.close).toHaveBeenCalledOnce();
  });

  const blockers: [string, (idle: FakeView) => void][] = [
    ['pinned', () => patchWorkbench(idleId, { pinned: true })],
    [
      'in a split view',
      () =>
        patchWorkbench(idleId, {
          views: [
            { id: 'v1', path: { pathname: '/all' } },
            { id: 'v2', path: { pathname: '/all' } },
          ],
        }),
    ],
    [
      'recording',
      () => {
        mocks.recording.status = { status: 'recording' };
      },
    ],
    [
      'finalizing a recording',
      () => {
        mocks.recording.status = { status: 'ready' };
      },
    ],
    [
      'audible',
      idle => {
        idle.state.audible = true;
      },
    ],
    [
      'loading',
      idle => {
        idle.state.loading = true;
      },
    ],
  ];

  test.each(blockers)('does not discard a tab that is %s', async (_, block) => {
    const { manager, idle, TAB_DISCARD_IDLE_MS } = await setup();
    block(idle);

    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS * 2);

    expect(idle.webContents.close).not.toHaveBeenCalled();
    expect(manager.tabViewsMap.has(idleId)).toBe(true);
  });

  test('discards a tab once it stops being audible', async () => {
    const { manager, idle, TAB_DISCARD_IDLE_MS } = await setup();
    idle.state.audible = true;
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS);
    expect(idle.webContents.close).not.toHaveBeenCalled();

    idle.state.audible = false;
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS);
    expect(idle.webContents.close).toHaveBeenCalledOnce();
    expect(manager.tabViewsMap.has(idleId)).toBe(false);
  });

  test('never empties the views map', async () => {
    const { manager, idle, TAB_DISCARD_IDLE_MS } = await setup();
    manager.webViewsMap$.next(
      new Map([[idleId, idle as unknown as WebContentsView]])
    );
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS);
    expect(manager.canDiscardTab(idleId)).toBe(false);
    expect(manager.tabViewsMap.size).toBe(1);
  });

  test('keeps tracking a tab whose renderer vetoed the unload', async () => {
    const { manager, idle, TAB_DISCARD_IDLE_MS } = await setup();
    await vi.advanceTimersByTimeAsync(TAB_DISCARD_IDLE_MS);
    expect(manager.tabViewsMap.has(idleId)).toBe(false);

    idle.listeners.get('will-prevent-unload')?.();

    expect(manager.tabViewsMap.get(idleId)).toBe(idle);
    const tabs = await firstValueFrom(manager.tabsStatus$);
    expect(tabs.find(t => t.id === idleId)).toMatchObject({
      loaded: true,
      ready: true,
    });
  });
});
