// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ workspace: {} as any, confirm: vi.fn() }));
vi.mock('@nota/infra', () => ({
  useService: () => ({ workspace: mocks.workspace }),
}));
vi.mock('@nota/core/modules/workspace', () => ({ WorkspaceService: class {} }));
vi.mock('@nota/component/setting-components', () => ({
  SettingRow: ({
    name,
    desc,
    children,
  }: {
    name: string;
    desc: string;
    children: ReactNode;
  }) => (
    <div>
      <h3>{name}</h3>
      <p>{desc}</p>
      {children}
    </div>
  ),
}));
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
vi.mock('@nota/component/ui/modal', () => ({
  useConfirmModal: () => ({ openConfirmModal: mocks.confirm }),
}));

import { LocalHistoryStoragePanel } from './local-history';

describe('local history storage cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspace = {
      engine: {
        doc: {
          waitForUpdated: vi.fn().mockResolvedValue(undefined),
          storage: {
            isHistorySupported: vi.fn().mockResolvedValue(true),
            getHistoryStorageUsage: vi
              .fn()
              .mockResolvedValue({
                versions: 4,
                historyBytes: 1024 * 1024,
                retainedRemovedBlobBytes: 2 * 1024 * 1024,
              }),
            clearHistories: vi.fn().mockResolvedValue(undefined),
          },
        },
      },
    };
  });
  afterEach(cleanup);
  test('shows retained media and requires a clear confirmation before cleanup', async () => {
    render(<LocalHistoryStoragePanel />);
    const clear = await screen.findByRole('button', {
      name: 'Clear history and removed files',
    });
    expect(screen.getByText(/4 saved versions/).textContent).toContain(
      '2.0 MB of removed files'
    );
    fireEvent.click(clear);
    expect(
      mocks.workspace.engine.doc.storage.clearHistories
    ).not.toHaveBeenCalled();
    const confirmation = mocks.confirm.mock.calls[0][0];
    expect(confirmation.description).toContain(
      'Current pages and their active files stay'
    );
    confirmation.onConfirm();
    await waitFor(() =>
      expect(
        mocks.workspace.engine.doc.storage.clearHistories
      ).toHaveBeenCalledOnce()
    );
    expect(mocks.workspace.engine.doc.waitForUpdated).toHaveBeenCalledOnce();
  });
  test('local save failure prevents deletion and remains visible', async () => {
    mocks.workspace.engine.doc.waitForUpdated.mockRejectedValue(
      new Error('Disk is full')
    );
    render(<LocalHistoryStoragePanel />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Clear history and removed files',
      })
    );
    mocks.confirm.mock.calls[0][0].onConfirm();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Disk is full')
    );
    expect(
      mocks.workspace.engine.doc.storage.clearHistories
    ).not.toHaveBeenCalled();
  });
  test('older mobile or native builds hide unsupported cleanup', async () => {
    mocks.workspace.engine.doc.storage.isHistorySupported.mockResolvedValue(
      false
    );
    render(<LocalHistoryStoragePanel />);
    await waitFor(() =>
      expect(
        mocks.workspace.engine.doc.storage.isHistorySupported
      ).toHaveBeenCalledOnce()
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      mocks.workspace.engine.doc.storage.getHistoryStorageUsage
    ).not.toHaveBeenCalled();
  });
});
