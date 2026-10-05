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

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  docs: { open: vi.fn() },
  dialogs: { open: vi.fn() },
  snapshot: vi.fn(),
  readable: vi.fn(),
  releases: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class {},
  isUserOwnedWorkspaceFlavour: () => true,
}));
vi.mock('@nota/core/modules/doc', () => ({ DocsService: class {} }));
vi.mock('@nota/core/modules/dialogs', () => ({
  WorkspaceDialogService: class {},
}));
vi.mock('@nota/infra', () => ({
  useService: (token: { name: string }) =>
    token.name === 'DocsService'
      ? mocks.docs
      : token.name === 'WorkspaceDialogService'
        ? mocks.dialogs
        : { workspace: mocks.workspace },
}));
vi.mock('@nota/core/modules/workspace/global-schema', () => ({
  getAFFiNEWorkspaceSchema: () => 'schema',
}));
vi.mock('@nota/core/components/hooks/nota/use-export-page', () => ({
  exportPageData: mocks.readable,
}));
vi.mock('@blocksuite/affine/widgets/linked-doc', () => ({
  ZipTransformer: { exportDocs: mocks.snapshot },
}));
vi.mock('@nota/component/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@nota/component/ui/modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { DataToolsDialog } from './index';

describe('shared data tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releases = [];
    mocks.workspace = {
      flavour: 'local',
      docCollection: {
        meta: { docMetas: [{ id: 'active' }, { id: 'trash', trash: true }] },
      },
      engine: {
        doc: {
          waitForDocLoaded: vi.fn().mockResolvedValue(undefined),
          waitForUpdated: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    mocks.docs.open.mockImplementation(id => {
      const release = vi.fn();
      mocks.releases.push(release);
      return { doc: { blockSuiteDoc: { id } }, release };
    });
    mocks.snapshot.mockResolvedValue(undefined);
    mocks.readable.mockResolvedValue(undefined);
  });
  afterEach(cleanup);
  test('loads active pages and flushes local saves before one workspace snapshot', async () => {
    render(<DataToolsDialog close={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nota snapshot' }));
    await screen.findByText('Exported 1 page.');
    expect(mocks.docs.open).toHaveBeenCalledOnce();
    expect(mocks.docs.open).toHaveBeenCalledWith('active');
    expect(mocks.workspace.engine.doc.waitForUpdated).toHaveBeenCalledOnce();
    expect(mocks.snapshot).toHaveBeenCalledWith(
      mocks.workspace.docCollection,
      'schema',
      [{ id: 'active' }]
    );
    expect(mocks.releases[0]).toHaveBeenCalledOnce();
  });
  test('selected databases use the existing readable export rules', async () => {
    render(<DataToolsDialog docIds={['chosen']} close={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'CSV databases' }));
    await screen.findByText('Exported 1 page.');
    expect(mocks.readable).toHaveBeenCalledWith({ id: 'chosen' }, 'csv');
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  test('failed local saving prevents download and releases temporary document handles', async () => {
    mocks.workspace.engine.doc.waitForUpdated.mockRejectedValue(
      new Error('Disk is full')
    );
    render(<DataToolsDialog close={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nota snapshot' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Disk is full')
    );
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.releases[0]).toHaveBeenCalledOnce();
  });
  test('preserves existing import completion navigation through the shared entry', () => {
    const close = vi.fn();
    render(<DataToolsDialog close={close} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Import notes or a database' })
    );
    const result = { docIds: ['imported'] };
    const [type, props, callback] = mocks.dialogs.open.mock.calls[0];
    expect(type).toBe('import');
    expect(props).toBeUndefined();
    callback(result);
    expect(close).toHaveBeenCalledWith(result);
  });
});
