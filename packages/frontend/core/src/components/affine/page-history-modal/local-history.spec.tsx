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
import { Doc as YDoc, encodeStateAsUpdate } from 'yjs';

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  canRestore: true,
  preview: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@nota/infra', () => ({
  useService: () => ({ workspace: mocks.workspace }),
}));
vi.mock('@nota/core/modules/workspace', () => ({ WorkspaceService: class {} }));
vi.mock('../../guard', () => ({ useGuard: () => mocks.canRestore }));
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
  Modal: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  useConfirmModal: () => ({ openConfirmModal: mocks.confirm }),
}));
vi.mock('../../../blocksuite/block-suite-editor', () => ({
  BlockSuiteEditor: ({ mode }: { mode: string }) => (
    <div data-testid="history-preview">{mode}</div>
  ),
}));
vi.mock('../../../blocksuite/block-suite-mode-switch', () => ({
  PureEditorModeSwitch: ({ setMode }: { setMode: (mode: string) => void }) => (
    <button onClick={() => setMode('edgeless')}>Whiteboard</button>
  ),
}));
vi.mock('./local-history-preview', () => ({
  createLocalHistoryPreview: mocks.preview,
}));

import { LocalPageHistoryModal } from './local-history';

describe('offline page history controls', () => {
  let current: Uint8Array;
  let live: YDoc;
  let close = vi.fn<(open: boolean) => void>();
  const timestamp = new Date('2026-10-05T12:00:00Z');
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRestore = true;
    live = new YDoc();
    current = encodeStateAsUpdate(live);
    close = vi.fn<(open: boolean) => void>();
    mocks.workspace = {
      engine: {
        doc: {
          waitForUpdated: vi.fn().mockResolvedValue(undefined),
          storage: {
            isHistorySupported: vi.fn().mockResolvedValue(true),
            createCheckpoint: vi.fn().mockResolvedValue({ bin: current }),
            listHistories: vi
              .fn()
              .mockResolvedValue([{ timestamp, userId: null }]),
            getHistory: vi.fn().mockResolvedValue({ bin: current }),
            rollbackDoc: vi.fn().mockResolvedValue(undefined),
            getDoc: vi.fn().mockResolvedValue({ bin: current }),
          },
        },
      },
      docCollection: {
        getDoc: () => ({
          spaceDoc: live,
          getStore: () => ({ root: { props: { title: 'Restored title' } } }),
        }),
        meta: { setDocMeta: vi.fn() },
      },
    };
    mocks.preview.mockReturnValue({ store: {}, dispose: vi.fn() });
    mocks.confirm.mockImplementation(({ onConfirm }) => {
      void onConfirm();
    });
  });
  afterEach(() => {
    cleanup();
    live.destroy();
  });
  const show = () =>
    render(
      <LocalPageHistoryModal
        open
        pageId="page"
        docCollection={mocks.workspace.docCollection}
        onOpenChange={close}
      />
    );

  test('checks build support before attempting a checkpoint', async () => {
    mocks.workspace.engine.doc.storage.isHistorySupported.mockResolvedValue(
      false
    );
    show();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('unavailable')
    );
    expect(
      mocks.workspace.engine.doc.storage.createCheckpoint
    ).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: 'Restore version',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
  test('restores through storage with the checkpoint concurrency guard and updates title metadata', async () => {
    show();
    const restore = screen.getByRole('button', {
      name: 'Restore version',
    }) as HTMLButtonElement;
    await waitFor(() => expect(restore.disabled).toBe(false));
    fireEvent.click(restore);
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mocks.workspace.engine.doc.storage.rollbackDoc).toHaveBeenCalledWith(
      live.guid,
      timestamp,
      undefined,
      current
    );
    expect(mocks.workspace.docCollection.meta.setDocMeta).toHaveBeenCalledWith(
      'page',
      { title: 'Restored title' }
    );
  });
  test('keeps stale restore errors visible without closing the page', async () => {
    mocks.workspace.engine.doc.storage.rollbackDoc.mockRejectedValue(
      new Error('The page has changed. Refresh history.')
    );
    show();
    const restore = screen.getByRole('button', {
      name: 'Restore version',
    }) as HTMLButtonElement;
    await waitFor(() => expect(restore.disabled).toBe(false));
    fireEvent.click(restore);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'page has changed'
      )
    );
    expect(close).not.toHaveBeenCalled();
    expect(mocks.workspace.engine.doc.storage.getDoc).not.toHaveBeenCalled();
  });
  test('allows read-only preview but respects edit permission for restore', async () => {
    mocks.canRestore = false;
    show();
    await screen.findByTestId('history-preview');
    expect(
      (
        screen.getByRole('button', {
          name: 'Restore version',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Whiteboard' }));
    expect(screen.getByTestId('history-preview').textContent).toBe('edgeless');
  });
  test('disposes detached previews when the modal closes', async () => {
    const dispose = vi.fn();
    mocks.preview.mockReturnValue({ store: {}, dispose });
    const view = show();
    await screen.findByTestId('history-preview');
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
