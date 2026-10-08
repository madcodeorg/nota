// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inWorkspace: false,
  globalOpen: vi.fn(),
  workspaceOpen: vi.fn(),
  openDoc: vi.fn(),
  openAll: vi.fn(),
}));

vi.mock('@blocksuite/icons/rc', () => ({
  ImportIcon: () => null,
  PlusIcon: () => null,
}));
vi.mock('@nota/component', () => ({
  ScrollableContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@nota/component/auth-components', () => ({
  NotaLogoIcon: () => null,
}));
vi.mock('@nota/component/ui/menu', () => ({
  MenuItem: ({
    children,
    onClick,
    'data-testid': testId,
  }: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string }) => (
    <button onClick={onClick} data-testid={testId}>
      {children}
    </button>
  ),
}));
vi.mock('@nota/core/modules/cloud', () => ({
  AuthService: class AuthService {},
  DefaultServerService: class DefaultServerService {},
}));
vi.mock('@nota/core/modules/dialogs', () => ({
  GlobalDialogService: class GlobalDialogService {},
  WorkspaceDialogService: class WorkspaceDialogService {},
}));
vi.mock('@nota/core/modules/workbench', () => ({
  WorkbenchService: class WorkbenchService {},
}));
vi.mock('@nota/graphql', () => ({
  ServerFeature: { LocalWorkspace: 'local' },
}));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@nota/infra', () => {
  const resolveService = (service: { name: string }) => {
    switch (service.name) {
      case 'GlobalDialogService':
        return { open: mocks.globalOpen };
      case 'WorkspaceDialogService':
        return mocks.inWorkspace ? { open: mocks.workspaceOpen } : undefined;
      case 'WorkbenchService':
        return mocks.inWorkspace
          ? { workbench: { openDoc: mocks.openDoc, openAll: mocks.openAll } }
          : undefined;
      case 'AuthService':
        // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
        return { session: { session$: { status: 'unauthenticated' } } };
      case 'DefaultServerService':
        return {
          server: {
            // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
            config$: {
              value: { features: ['local'] },
              selector: () => true,
            },
          },
        };
      default:
        throw new Error(`Unexpected service: ${service.name}`);
    }
  };
  return {
    useLiveData: (value: unknown) => value,
    useServiceOptional: resolveService,
    useService: (service: { name: string }) => {
      const value = resolveService(service);
      if (!value) throw new Error(`${service.name} is not registered`);
      return value;
    },
  };
});
vi.mock('@nota/track', () => ({
  track: {
    // eslint-disable-next-line rxjs/finnish -- Preserve the tracker API in the stub.
    $: {
      navigationPanel: {
        workspaceList: { createWorkspace: vi.fn() },
        importModal: { open: vi.fn() },
      },
    },
  },
}));
vi.mock('./workspace-list', () => ({ NotaWorkspaceList: () => null }));
vi.mock('./index.css', () => ({
  workspaceScrollArea: '',
  workspaceScrollAreaViewport: '',
  scrollbar: '',
  scrollbarThumb: '',
  workspaceFooter: '',
  menuItem: '',
}));
vi.mock('./add-workspace/index.css', () => ({
  prefixIcon: '',
  ItemContainer: '',
  ItemText: '',
}));

import { UserWithWorkspaceList } from './index';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inWorkspace = false;
  vi.stubGlobal('BUILD_CONFIG', {
    ...BUILD_CONFIG,
    isElectron: true,
    isNative: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workspace selector before a workspace is open', () => {
  test('renders creation and workspace-import recovery without scoped services', () => {
    const onCreatedWorkspace = vi.fn();
    const onEventEnd = vi.fn();
    render(
      <UserWithWorkspaceList
        onCreatedWorkspace={onCreatedWorkspace}
        onEventEnd={onEventEnd}
      />
    );
    expect(screen.queryByTestId('import-docs')).toBeNull();

    fireEvent.click(screen.getByTestId('new-workspace'));
    expect(mocks.globalOpen).toHaveBeenLastCalledWith(
      'create-workspace',
      {},
      expect.any(Function)
    );
    const created = { metadata: { id: 'new', flavour: 'local' } };
    mocks.globalOpen.mock.calls[0][2](created);
    expect(onCreatedWorkspace).toHaveBeenLastCalledWith(created);

    fireEvent.click(screen.getByTestId('add-workspace'));
    expect(mocks.globalOpen).toHaveBeenLastCalledWith(
      'import-workspace',
      undefined,
      expect.any(Function)
    );
    const imported = { id: 'imported', flavour: 'local' };
    mocks.globalOpen.mock.calls[1][2]({ workspace: imported });
    expect(onCreatedWorkspace).toHaveBeenLastCalledWith({ metadata: imported });
    expect(onEventEnd).toHaveBeenCalledTimes(2);
    expect(mocks.workspaceOpen).not.toHaveBeenCalled();
  });

  test('keeps document import available once workspace services exist', () => {
    mocks.inWorkspace = true;
    render(<UserWithWorkspaceList />);
    fireEvent.click(screen.getByTestId('import-docs'));
    expect(mocks.workspaceOpen).toHaveBeenCalledWith(
      'import',
      undefined,
      expect.any(Function)
    );
    mocks.workspaceOpen.mock.calls[0][2]({ docIds: ['page'] });
    expect(mocks.openDoc).toHaveBeenCalledWith('page');
  });
});
