/** @vitest-environment happy-dom */
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
  openDoc: vi.fn(),
  openDialog: vi.fn(),
  readable: vi.fn(),
  page: vi.fn(),
  snapshot: vi.fn(),
  releases: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('@nota/infra', () => ({
  useService: (service: { name: string }) =>
    service.name === 'WorkspaceService'
      ? { workspace: mocks.workspace }
      : service.name === 'DocsService'
        ? { open: mocks.openDoc }
        : { open: mocks.openDialog },
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
  isUserOwnedWorkspaceFlavour: (flavour: string) => flavour === 'local',
}));
vi.mock('@nota/core/modules/doc', () => ({
  DocsService: class DocsService {},
}));
vi.mock('@nota/core/modules/dialogs', () => ({
  WorkspaceDialogService: class WorkspaceDialogService {},
}));
vi.mock('@nota/core/components/hooks/nota/use-export-page', () => ({
  exportReadablePages: mocks.readable,
  exportPageData: mocks.page,
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

describe('workspace readable export controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releases = [];
    mocks.workspace = {
      flavour: 'local',
      docCollection: {
        meta: {
          docMetas: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'trash', trash: true },
          ],
        },
      },
      engine: {
        doc: {
          waitForDocLoaded: vi.fn().mockResolvedValue(undefined),
          waitForUpdated: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    mocks.openDoc.mockImplementation(id => {
      const release = vi.fn();
      mocks.releases.push(release);
      return { doc: { blockSuiteDoc: { id } }, release };
    });
    mocks.readable.mockResolvedValue(undefined);
  });
  afterEach(cleanup);
  test.each(['Markdown', 'HTML'])(
    'exports %s workspace pages with one grouped request and releases documents',
    async label => {
      render(<DataToolsDialog close={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(mocks.readable).toHaveBeenCalledOnce());
      expect(mocks.readable.mock.calls[0][0]).toEqual([
        { id: 'a' },
        { id: 'b' },
      ]);
      expect(mocks.readable.mock.calls[0][1]).toBe(label.toLowerCase());
      expect(mocks.page).not.toHaveBeenCalled();
      await screen.findByText('Exported 2 pages.');
      expect(
        mocks.releases.every(release => release.mock.calls.length === 1)
      ).toBe(true);
    }
  );
  test('selected page scope only prepares the supplied page and shows actionable failures', async () => {
    mocks.readable.mockRejectedValue(
      new Error('A required local attachment is unavailable.')
    );
    render(<DataToolsDialog close={vi.fn()} docIds={['b']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'required local attachment'
    );
    expect(mocks.openDoc).toHaveBeenCalledExactlyOnceWith('b');
    expect(mocks.releases[0]).toHaveBeenCalledOnce();
  });
  test('cancel stops the grouped request, releases open pages and permits another export', async () => {
    mocks.readable.mockImplementation(
      (_pages, _format, signal: AbortSignal) =>
        new Promise<void>((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          })
        )
    );
    render(<DataToolsDialog close={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
    await waitFor(() => expect(mocks.readable).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    await screen.findByText('Export cancelled.');
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'HTML' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    expect((mocks.readable.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
    expect(
      mocks.releases.every(release => release.mock.calls.length === 1)
    ).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
