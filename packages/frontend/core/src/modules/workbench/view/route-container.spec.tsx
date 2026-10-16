// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { lazy, type ReactNode } from 'react';
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

const mocks = vi.hoisted(() => ({
  pingAppLayoutReady: vi.fn(),
  outlet: { current: null as null | (() => ReactNode) },
}));

vi.mock('@nota/component', () => ({
  Loading: () => <div data-testid="route-loading" />,
}));
vi.mock('@nota/core/components/affine/affine-error-boundary', () => ({
  AffineErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@nota/infra', () => ({
  useService: () => ({ view: { id: 'view-1' } }),
  useServiceOptional: () => ({
    handler: { ui: { pingAppLayoutReady: mocks.pingAppLayoutReady } },
  }),
}));
vi.mock('../../desktop-api', () => ({
  DesktopApiService: class DesktopApiService {},
}));
vi.mock('../services/view', () => ({ ViewService: class ViewService {} }));
vi.mock('./view-islands', () => ({
  ViewBodyTarget: () => null,
  ViewHeaderTarget: () => null,
}));
vi.mock('react-router-dom', () => ({
  Outlet: () => mocks.outlet.current?.(),
}));

import { RouteContainer } from './route-container';

const createLazyRoute = () => {
  let resolve!: () => void;
  const loaded = new Promise<void>(r => (resolve = r));
  const Page = lazy(async () => {
    await loaded;
    return { default: () => <main>Loaded page</main> };
  });
  return { Page, resolve };
};

const flushFrames = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
};

describe('route container ready signal', () => {
  beforeAll(() => {
    vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, isElectron: true });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
    mocks.pingAppLayoutReady.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  afterAll(() => vi.unstubAllGlobals());

  test('pings only after the lazy route resolved, and only once', async () => {
    const { Page, resolve } = createLazyRoute();
    mocks.outlet.current = () => <Page />;
    render(<RouteContainer />);

    expect(screen.getByTestId('route-loading')).toBeTruthy();
    await flushFrames();
    expect(mocks.pingAppLayoutReady).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
    });
    expect(screen.getByRole('main').textContent).toBe('Loaded page');
    expect(mocks.pingAppLayoutReady).not.toHaveBeenCalled();

    await flushFrames();
    expect(mocks.pingAppLayoutReady).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.pingAppLayoutReady).toHaveBeenCalledOnce();
  });

  test('pings after the timeout when the route never resolves', async () => {
    const { Page } = createLazyRoute();
    mocks.outlet.current = () => <Page />;
    render(<RouteContainer />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2900);
    });
    expect(mocks.pingAppLayoutReady).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.pingAppLayoutReady).toHaveBeenCalledOnce();
  });

  test('does not ping after unmounting before the timeout', async () => {
    const { Page } = createLazyRoute();
    mocks.outlet.current = () => <Page />;
    const view = render(<RouteContainer />);
    view.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.pingAppLayoutReady).not.toHaveBeenCalled();
  });
});
