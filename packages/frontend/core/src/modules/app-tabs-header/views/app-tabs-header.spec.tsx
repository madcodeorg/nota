// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import type { AppContainer as AppContainerType } from '../../../desktop/components/app-container';

const mocks = vi.hoisted(() => ({
  desktopApi: {
    handler: {
      ui: { pingAppLayoutReady: vi.fn(), isFullScreen: vi.fn() },
    },
    events: { ui: { onFullScreen: vi.fn() } },
  },
  // eslint-disable-next-line rxjs/finnish -- Mock LiveData values while retaining the service API.
  sidebar: { width$: 300, open$: false, resizing$: false },
  // eslint-disable-next-line rxjs/finnish -- Mock LiveData values while retaining the service API.
  tabs: { tabsStatus$: [] },
}));

vi.mock('@nota/core/modules/app-sidebar', () => ({
  AppSidebarService: class AppSidebarService {},
}));
vi.mock('../../desktop-api', () => ({
  DesktopApiService: class DesktopApiService {},
}));
vi.mock('../services/app-tabs-header-service', () => ({
  AppTabsHeaderService: class AppTabsHeaderService {},
}));
vi.mock('../../navigation', () => ({
  resolveLinkToDoc: vi.fn(),
  NavigationButtons: () => null,
}));
vi.mock('../../workbench/constants', () => ({ iconNameToIcon: {} }));
vi.mock('../../workbench/services/desktop-state-synchronizer', () => ({
  DesktopStateSynchronizer: class DesktopStateSynchronizer {},
}));
vi.mock('@nota/infra', () => ({
  useLiveData: (value: unknown) => value,
  useService: (token: { name: string }) => {
    switch (token.name) {
      case 'AppSidebarService':
        return { sidebar: mocks.sidebar };
      case 'AppTabsHeaderService':
        return mocks.tabs;
      case 'DesktopApiService':
        return mocks.desktopApi;
      default:
        throw new Error(`Unexpected service: ${token.name}`);
    }
  },
  useServiceOptional: (token: { name: string }) =>
    token.name === 'DesktopApiService' ? mocks.desktopApi : undefined,
}));
vi.mock('@nota/i18n', () => ({
  useI18n: () => ({ 'com.affine.multi-tab.new-tab': () => 'New tab' }),
}));
vi.mock('@nota/track', () => ({
  // eslint-disable-next-line rxjs/finnish -- Preserve the existing tracking API shape.
  track: { $: { appTabsHeader: { $: { tabAction: vi.fn() } } } },
}));
vi.mock('@nota/core/components/hooks/nota-async-hooks', () => ({
  useAsyncCallback: (callback: unknown) => callback,
}));
vi.mock('@nota/core/components/hooks/use-catch-event-hook', () => ({
  useCatchEventCallback: (callback: unknown) => callback,
}));
vi.mock('@nota/component', () => ({
  IconButton: ({
    children,
    icon,
    size: _size,
    tooltip: _tooltip,
    tooltipShortcut: _tooltipShortcut,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
    size?: number | string;
    tooltip?: string;
    tooltipShortcut?: string[];
  }) => <button {...props}>{children ?? icon}</button>,
  Loading: () => null,
  useDropTarget: () => ({
    dropTargetRef: () => {},
    draggedOver: false,
  }),
  useDraggable: () => ({ dragRef: () => {} }),
}));
vi.mock('@nota/core/components/hooks/nota/use-app-setting-helper', () => ({
  useAppSettingHelper: () => ({ appSettings: {} }),
}));
vi.mock('@nota/core/components/root-app-sidebar', () => ({
  RootAppSidebar: () => null,
}));
vi.mock('@nota/core/modules/app-sidebar/views', () => ({
  AppSidebarFallback: () => <aside aria-label="Loading sidebar" />,
  OpenInAppCard: () => null,
  SidebarSwitch: () => null,
}));
vi.mock('@nota/core/modules/quicksearch/services/cmdk', () => ({
  CMDKQuickSearchService: class CMDKQuickSearchService {},
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
}));
vi.mock('@nota/core/modules/app-tabs-header', async () =>
  vi.importActual('./app-tabs-header')
);

import { AppTabsHeader } from './app-tabs-header';

let AppContainer: typeof AppContainerType;

describe('desktop layout readiness', () => {
  beforeAll(async () => {
    // AppContainer selects its desktop layout once when the module loads.
    vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, isElectron: true });
    ({ AppContainer } =
      await import('../../../desktop/components/app-container'));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.desktopApi.handler.ui.pingAppLayoutReady.mockResolvedValue(undefined);
    mocks.desktopApi.handler.ui.isFullScreen.mockResolvedValue(false);
  });
  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());

  test('withholds the app readiness signal until the header becomes ready', async () => {
    const view = render(<AppTabsHeader ready={false} />);
    expect(screen.getByTestId('add-tab-view-button')).toBeTruthy();
    expect(
      mocks.desktopApi.handler.ui.pingAppLayoutReady
    ).not.toHaveBeenCalled();

    view.rerender(<AppTabsHeader ready />);
    await waitFor(() =>
      expect(
        mocks.desktopApi.handler.ui.pingAppLayoutReady
      ).toHaveBeenCalledOnce()
    );

    view.rerender(<AppTabsHeader ready />);
    expect(
      mocks.desktopApi.handler.ui.pingAppLayoutReady
    ).toHaveBeenCalledOnce();
  });

  test('a ready shell does not complete the app layout handoff', () => {
    const view = render(<AppTabsHeader mode="shell" ready={false} />);
    view.rerender(<AppTabsHeader mode="shell" ready />);
    expect(
      mocks.desktopApi.handler.ui.pingAppLayoutReady
    ).not.toHaveBeenCalled();
  });

  test('normal app headers retain their default readiness signal', async () => {
    render(<AppTabsHeader />);
    await waitFor(() =>
      expect(
        mocks.desktopApi.handler.ui.pingAppLayoutReady
      ).toHaveBeenCalledOnce()
    );
  });

  test('the fallback container waits for normal app content before signaling ready', async () => {
    const view = render(<AppContainer fallback />);
    expect(
      screen.getByRole('complementary', { name: 'Loading sidebar' })
    ).toBeTruthy();
    expect(screen.getByTestId('add-tab-view-button')).toBeTruthy();
    expect(
      mocks.desktopApi.handler.ui.pingAppLayoutReady
    ).not.toHaveBeenCalled();

    view.rerender(
      <AppContainer>
        <main>Workspace content</main>
      </AppContainer>
    );
    expect(screen.getByRole('main').textContent).toBe('Workspace content');
    expect(
      screen.queryByRole('complementary', { name: 'Loading sidebar' })
    ).toBeNull();
    await waitFor(() =>
      expect(
        mocks.desktopApi.handler.ui.pingAppLayoutReady
      ).toHaveBeenCalledOnce()
    );
  });
});
