// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  ping: vi.fn(),
  openPage: vi.fn(),
  jumpToPage: vi.fn(),
  workspaces: [] as { id: string; flavour: string }[],
  loading: false,
  // Both cloud import paths resolve to one module, so share one mock shape.
  cloud: {
    DefaultServerService: class DefaultServerService {},
    AuthService: class AuthService {},
  },
}));
vi.mock('@nota/core/modules/cloud', () => mocks.cloud);
vi.mock('../../../modules/cloud', () => mocks.cloud);
vi.mock('@nota/core/modules/desktop-api', () => ({
  DesktopApiService: class DesktopApiService {},
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspacesService: class WorkspacesService {},
}));
vi.mock('@nota/core/utils/first-app-data', () => ({
  createFirstAppData: mocks.create,
  buildShowcaseWorkspace: vi.fn(),
  isFirstAppOpen: () => localStorage.getItem('is-first-open') === null,
}));
vi.mock('@nota/graphql', () => ({
  ServerFeature: { LocalWorkspace: 'local' },
}));
vi.mock('@nota/infra', () => ({
  useService: (token: { name: string }) =>
    ({
      // eslint-disable-next-line rxjs/finnish -- Match the service LiveData API with lightweight tokens.
      AuthService: { session: { status$: { map: () => 'logged-in' } } },
      DefaultServerService: {
        // eslint-disable-next-line rxjs/finnish -- Match the service LiveData API with lightweight tokens.
        server: { config$: { selector: () => 'local-enabled' } },
      },
      WorkspacesService: {
        // eslint-disable-next-line rxjs/finnish -- Match the service LiveData API with lightweight tokens.
        list: { workspaces$: 'workspaces', isRevalidating$: 'loading' },
      },
    })[token.name],
  useServiceOptional: () => ({
    handler: { ui: { pingAppLayoutReady: mocks.ping } },
  }),
  useLiveData: (token: string) =>
    ({
      'logged-in': false,
      'local-enabled': true,
      workspaces: mocks.workspaces,
      loading: mocks.loading,
    })[token],
}));
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../../../components/hooks/use-navigate-helper', () => ({
  RouteLogic: { REPLACE: 'replace' },
  useNavigateHelper: () => ({
    openPage: mocks.openPage,
    jumpToPage: mocks.jumpToPage,
    jumpToSignIn: vi.fn(),
  }),
}));
vi.mock('../../../components/workspace-selector', () => ({
  WorkspaceNavigator: () => <div>Choose a workspace</div>,
}));
vi.mock('../../components/app-container', () => ({
  AppContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>Loading workspace{children}</div>
  ),
}));

import { Component } from './index';

describe('initial workspace handoff readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.workspaces = [];
    mocks.loading = false;
    mocks.ping.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('pending first creation cannot report ready, including StrictMode', async () => {
    let resolveCreate!: (value: object) => void;
    mocks.create.mockReturnValue(
      new Promise(resolve => {
        resolveCreate = resolve;
      })
    );
    render(
      <StrictMode>
        <Component />
      </StrictMode>
    );
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.ping).not.toHaveBeenCalled();
    expect(screen.queryByText('Choose a workspace')).toBeNull();
    await act(async () => {
      localStorage.setItem('is-first-open', 'false');
      resolveCreate({
        meta: { id: 'workspace-a' },
        defaultPageId: 'first-note',
      });
    });
    expect(mocks.jumpToPage).toHaveBeenCalledWith('workspace-a', 'first-note');
    // The lazy workspace route has not mounted yet; the selector must not
    // take over (it re-render-looped on first launch) and nothing pings ready.
    expect(screen.getByText('Loading workspace')).toBeTruthy();
    expect(screen.queryByText('Choose a workspace')).toBeNull();
    expect(mocks.ping).not.toHaveBeenCalled();
  });

  test('failed creation stays unready and offers an explicit retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.create
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockImplementationOnce(async () => {
        localStorage.setItem('is-first-open', 'false');
        return { meta: { id: 'workspace-a' } };
      });
    render(<Component />);
    await screen.findByRole('alert');
    expect(mocks.ping).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(mocks.openPage).toHaveBeenCalledWith('workspace-a', 'all')
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  test('loading and navigation fallbacks never report ready', () => {
    mocks.loading = true;
    render(<Component />);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.ping).not.toHaveBeenCalled();
  });

  test('an intentional empty workspace selector is interactive after earlier setup', async () => {
    localStorage.setItem('is-first-open', 'false');
    render(<Component />);
    expect(screen.getByText('Choose a workspace')).toBeTruthy();
    await waitFor(() => expect(mocks.ping).toHaveBeenCalledOnce());
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
