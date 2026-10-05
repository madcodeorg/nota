// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {
    persistenceErrorMessage: null as string | null,
    persistenceRetrying: false,
  },
  retry: vi.fn(),
  exportDocs: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('@nota/component', () => ({ notify: { error: mocks.notifyError } }));
vi.mock('@nota/component/ui/button', () => ({
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock('@blocksuite/affine/widgets/linked-doc', () => ({
  ZipTransformer: { exportDocs: mocks.exportDocs },
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class {},
  getAFFiNEWorkspaceSchema: () => ({}),
}));
vi.mock('@nota/infra', () => ({
  LiveData: { from: vi.fn() },
  useLiveData: () => mocks.state,
  useService: () => ({
    workspace: {
      // eslint-disable-next-line rxjs/finnish
      engine: { doc: { state$: {}, retryPersistence: mocks.retry } },
      docCollection: {
        docs: new Map([
          ['loaded', { getStore: () => ({ root: {} }) }],
          ['unloaded', { getStore: () => ({ root: null }) }],
        ]),
      },
    },
  }),
}));

import { LocalPersistenceStatus } from './local-persistence-status';

describe('local save recovery UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = { persistenceErrorMessage: null, persistenceRetrying: false };
    mocks.retry.mockResolvedValue(undefined);
    mocks.exportDocs.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  test('stays out of the workspace when local saving succeeds', () => {
    render(<LocalPersistenceStatus />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('exposes the failed save and retries explicitly', async () => {
    mocks.state.persistenceErrorMessage = 'Disk is full';
    render(<LocalPersistenceStatus />);
    expect(screen.getByRole('alert').textContent).toContain(
      'not saved on this device'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledOnce());
  });

  test('reports failed retries without hiding the recovery controls', async () => {
    mocks.state.persistenceErrorMessage = 'Disk is full';
    mocks.retry.mockRejectedValue(new Error('Disk is still full'));
    render(<LocalPersistenceStatus />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith({
        title: 'Changes are still not saved',
        message: 'Disk is still full',
      })
    );
    expect(
      screen.getByRole('button', { name: 'Export open pages' })
    ).toBeTruthy();
  });

  test('guards close only while a save failure is present', () => {
    mocks.state.persistenceErrorMessage = 'Write failed';
    const view = render(<LocalPersistenceStatus />);
    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    mocks.state = { persistenceErrorMessage: null, persistenceRetrying: false };
    view.rerender(<LocalPersistenceStatus />);
    const allowed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });

  test('exports available live pages and reports incomplete export failures', async () => {
    mocks.state.persistenceErrorMessage = 'Write failed';
    mocks.exportDocs.mockRejectedValue(new Error('An attachment is missing'));
    render(<LocalPersistenceStatus />);
    fireEvent.click(screen.getByRole('button', { name: 'Export open pages' }));
    await waitFor(() => expect(mocks.exportDocs).toHaveBeenCalledOnce());
    expect(mocks.exportDocs.mock.calls[0][2]).toHaveLength(1);
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith({
        title: 'Could not export open pages',
        message: 'An attachment is missing',
      })
    );
  });
});
