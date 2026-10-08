/* eslint-disable rxjs/finnish */
// @vitest-environment happy-dom
import {
  act,
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
  user: null as { sub: string } | null,
  connect: vi.fn(),
  toDrive: vi.fn(),
  toLocal: vi.fn(),
  jump: vi.fn(),
  openDialog: vi.fn(),
  owner: undefined as string | undefined,
  paused: false,
  setPaused: vi.fn(),
  refreshModels: vi.fn(),
  setModel: vi.fn(),
  watchLocalModelDownload: vi.fn(),
  notify: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock('@nota/component/ui/notification', () => ({ notify: mocks.notify }));
vi.mock('@nota/core/modules/ai-button/services/models', () => ({
  AIModelService: class AIModelService {},
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
  isUserOwnedWorkspaceFlavour: (flavour: string) =>
    flavour === 'local' || flavour === 'google-drive',
}));
vi.mock('@nota/core/modules/dialogs', () => ({
  WorkspaceDialogService: class WorkspaceDialogService {},
}));
vi.mock('@nota/core/modules/google-auth', () => ({
  GoogleAuthService: class GoogleAuthService {},
}));
vi.mock('@nota/core/modules/workspace/services/transform', () => ({
  WorkspaceTransformService: class WorkspaceTransformService {},
}));
vi.mock('@nota/core/modules/workspace-engine/impls/google-drive', () => ({
  getGoogleDriveWorkspaceOwner: () => mocks.owner,
  isGoogleDriveWorkspaceSyncPaused: () => mocks.paused,
  setGoogleDriveWorkspaceSyncPaused: mocks.setPaused,
}));
vi.mock('@nota/core/components/hooks/use-navigate-helper', () => ({
  useNavigateHelper: () => ({ jumpToPage: mocks.jump }),
}));
vi.mock('@nota/infra', () => ({
  useService: (service: { name: string }) => {
    if (service.name === 'WorkspaceService')
      return { workspace: mocks.workspace };
    if (service.name === 'WorkspaceDialogService')
      return { open: mocks.openDialog };
    if (service.name === 'AIModelService')
      return {
        refreshModels: mocks.refreshModels,
        setModel: mocks.setModel,
        watchLocalModelDownload: mocks.watchLocalModelDownload,
      };
    if (service.name === 'WorkspaceTransformService')
      return {
        transformLocalToCloud: mocks.toDrive,
        transformDriveToLocal: mocks.toLocal,
      };
    if (service.name === 'GoogleAuthService')
      return {
        connect: mocks.connect,
        session: {
          userInfo$: {
            get value() {
              return mocks.user;
            },
            subscribe: (next: (user: unknown) => void) => {
              next(mocks.user);
              return { unsubscribe: vi.fn() };
            },
          },
        },
      };
    throw new Error(`Unexpected service: ${service.name}`);
  },
  useLiveData: (data: { value: unknown }) => data.value,
}));
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
    <section>
      <h3>{name}</h3>
      <p>{desc}</p>
      {children}
    </section>
  ),
}));
vi.mock('@nota/component/ui/button', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@nota/component/ui/modal', () => ({
  Modal: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        <button onClick={() => onOpenChange(false)}>Dismiss setup</button>
        {children}
      </div>
    ) : null,
}));
vi.mock('./nota-welcome.css', () => ({ error: 'error' }));
vi.mock('./setup-panel', () => ({
  NotaSetupPanel: ({
    step,
    onStepChange,
    onFinish,
    driveContent,
    onImport,
    imported,
    onChatSelected,
    onChatAction,
  }: {
    step:
      | 'models'
      | 'drive'
      | 'transcription'
      | 'chat'
      | 'permissions'
      | 'import';
    onStepChange: (
      step:
        | 'models'
        | 'drive'
        | 'transcription'
        | 'chat'
        | 'permissions'
        | 'import'
    ) => void;
    onFinish: () => void;
    driveContent: ReactNode;
    onImport: () => void;
    imported?: boolean;
    onChatSelected: (id: string) => Promise<void>;
    onChatAction: (id: string, action: 'download' | 'probe') => Promise<void>;
  }) => (
    <section aria-label="Setup steps">
      <h2>{step}</h2>
      {step === 'models' ? (
        <>
          <button onClick={() => void onChatSelected('chosen-model')}>
            Save chat choice
          </button>
          <button onClick={() => void onChatAction('chosen-model', 'download')}>
            Download chat model
          </button>
          <button onClick={() => void onChatAction('chosen-model', 'probe')}>
            Probe chat model
          </button>
        </>
      ) : null}
      {step === 'drive' ? driveContent : null}
      {step !== 'models' ? (
        <button
          onClick={() => {
            const previous = {
              drive: 'models',
              transcription: 'drive',
              chat: 'transcription',
              permissions: 'chat',
              import: 'permissions',
            } as const;
            onStepChange(previous[step as keyof typeof previous]);
          }}
        >
          Back
        </button>
      ) : null}
      {step !== 'import' ? (
        <button
          onClick={() => {
            const next = {
              models: 'drive',
              drive: 'transcription',
              transcription: 'chat',
              chat: 'permissions',
              permissions: 'import',
            } as const;
            onStepChange(next[step as keyof typeof next]);
          }}
        >
          Next
        </button>
      ) : (
        <>
          <button onClick={onImport}>Import content</button>
          {imported ? <p>Import completed</p> : null}
        </>
      )}
      <button onClick={onFinish}>Start working</button>
    </section>
  ),
}));

import {
  getWelcomeState,
  getWorkspaceSetupState,
  updateWelcomeState,
  updateWorkspaceSetupState,
} from './setup-state';
import { NotaSetupSettings, WorkspaceSetup } from './workspace-setup';

function enterWorkspace(id: string, flavour = 'local') {
  mocks.workspace = {
    id,
    flavour,
    meta: { id, flavour },
    engine: {
      client: { setGoogleDriveTokens: vi.fn().mockResolvedValue(undefined) },
    },
  };
}

describe('workspace setup composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jump.mockReset();
    mocks.refreshModels.mockResolvedValue(undefined);
    localStorage.clear();
    mocks.user = null;
    mocks.owner = undefined;
    mocks.paused = false;
    enterWorkspace('local');
    mocks.connect.mockImplementation(async () => {
      mocks.user = { sub: 'owner' };
    });
    mocks.toDrive.mockResolvedValue({
      id: 'drive-copy',
      flavour: 'google-drive',
    });
    updateWelcomeState({ showSetup: true, setupStep: 'models' });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Flush a failed-storage test's same-session fallback before the next test.
    updateWelcomeState({});
    updateWorkspaceSetupState(mocks.workspace.id, {});
    localStorage.clear();
  });

  test('progresses and resumes without authenticating, copying or importing on mount', () => {
    const view = render(<WorkspaceSetup />);
    expect(screen.getByRole('heading', { name: 'models' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(getWorkspaceSetupState('local').setupStep).toBe('transcription');
    expect(getWelcomeState().showSetup).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    view.unmount();
    render(<WorkspaceSetup />);
    expect(screen.getByRole('heading', { name: 'drive' })).toBeTruthy();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.toDrive).not.toHaveBeenCalled();
    expect(mocks.openDialog).not.toHaveBeenCalled();
  });

  test('persists the import handoff before real Drive copying navigates', async () => {
    updateWorkspaceSetupState('local', { setupStep: 'drive' });
    mocks.jump.mockImplementation(() => {
      expect(getWorkspaceSetupState('drive-copy').setupStep).toBe(
        'transcription'
      );
      expect(getWelcomeState().showSetup).toBe(true);
    });
    const view = render(<WorkspaceSetup />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('drive-copy', 'all')
    );
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.toDrive).toHaveBeenCalledWith(
      mocks.workspace,
      null,
      'google-drive'
    );
    view.unmount();
    enterWorkspace('drive-copy', 'google-drive');
    render(<WorkspaceSetup />);
    expect(screen.getByRole('heading', { name: 'transcription' })).toBeTruthy();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.toDrive).toHaveBeenCalledOnce();
    expect(mocks.openDialog).not.toHaveBeenCalled();
  });

  test('refreshes the chat catalog before applying an explicitly saved local model choice', async () => {
    let refreshed: () => void = () => {};
    mocks.refreshModels.mockImplementation(
      () => new Promise<void>(resolve => (refreshed = resolve))
    );
    render(<WorkspaceSetup />);
    expect(mocks.refreshModels).not.toHaveBeenCalled();
    expect(mocks.setModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save chat choice' }));
    expect(mocks.refreshModels).toHaveBeenCalledOnce();
    expect(mocks.setModel).not.toHaveBeenCalled();
    refreshed();
    await waitFor(() =>
      expect(mocks.setModel).toHaveBeenCalledWith('local:chosen-model')
    );
  });

  test('a chat download starts the existing service monitor without selecting a model', () => {
    render(<WorkspaceSetup />);
    expect(mocks.watchLocalModelDownload).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Download chat model' })
    );
    expect(mocks.watchLocalModelDownload).toHaveBeenCalledExactlyOnceWith(
      'chosen-model'
    );
    expect(mocks.refreshModels).not.toHaveBeenCalled();
    expect(mocks.setModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.watchLocalModelDownload).toHaveBeenCalledOnce();
    expect(mocks.setModel).not.toHaveBeenCalled();
  });

  test('a successful chat probe refreshes readiness without selecting a model', async () => {
    render(<WorkspaceSetup />);
    expect(mocks.refreshModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Probe chat model' }));
    await waitFor(() => expect(mocks.refreshModels).toHaveBeenCalledOnce());
    expect(mocks.watchLocalModelDownload).not.toHaveBeenCalled();
    expect(mocks.setModel).not.toHaveBeenCalled();
  });

  test.each(['Next', 'Start working'])(
    '%s while Drive setup is pending prevents a stale copy from navigating or reopening setup',
    async action => {
      updateWorkspaceSetupState('local', { setupStep: 'drive' });
      let copied: (metadata: {
        id: string;
        flavour: string;
      }) => void = () => {};
      mocks.toDrive.mockImplementation(
        () => new Promise(resolve => (copied = resolve))
      );
      render(<WorkspaceSetup />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Connect Google Drive' })
      );
      await waitFor(() => expect(mocks.toDrive).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole('button', { name: action }));
      await act(async () => {
        copied({ id: 'drive-copy', flavour: 'google-drive' });
      });
      expect(mocks.jump).not.toHaveBeenCalled();
      expect(getWorkspaceSetupState('drive-copy').setupStep).toBeUndefined();
      expect(getWelcomeState().showSetup).toBe(action === 'Next');
      if (action === 'Next')
        expect(
          screen.getByRole('heading', { name: 'transcription' })
        ).toBeTruthy();
      else expect(screen.queryByRole('dialog')).toBeNull();
    }
  );

  test('suspends the wizard for actual import, resumes on cancel and records successful pages', async () => {
    updateWorkspaceSetupState('local', { setupStep: 'import' });
    render(<WorkspaceSetup />);
    fireEvent.click(screen.getByRole('button', { name: 'Import content' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.openDialog).toHaveBeenCalledWith(
      'import',
      undefined,
      expect.any(Function)
    );
    const cancelled = mocks.openDialog.mock.calls[0][2];
    await act(() => cancelled(undefined));
    expect(screen.getByRole('heading', { name: 'import' })).toBeTruthy();
    expect(screen.queryByText('Import completed')).toBeNull();
    expect(getWelcomeState().showSetup).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Import content' }));
    const completed = mocks.openDialog.mock.calls[1][2];
    await act(() => completed({ docIds: ['page'], entryId: 'page' }));
    expect(screen.getByText('Import completed')).toBeTruthy();
    expect(getWorkspaceSetupState('local').imported).toBe(true);
    expect(mocks.openDialog).toHaveBeenCalledTimes(2);
  });

  test('keeps backup import completion when its destination workspace opens', async () => {
    updateWorkspaceSetupState('local', { setupStep: 'import' });
    const view = render(<WorkspaceSetup />);
    fireEvent.click(screen.getByRole('button', { name: 'Import content' }));
    await act(() =>
      mocks.openDialog.mock.calls[0][2]({ docIds: [], isWorkspaceFile: true })
    );
    expect(getWelcomeState().imported).toBe(true);
    view.unmount();
    enterWorkspace('imported-workspace');
    render(<WorkspaceSetup />);
    expect(screen.getByRole('heading', { name: 'import' })).toBeTruthy();
    expect(screen.getByText('Import completed')).toBeTruthy();
    expect(mocks.openDialog).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }));
    expect(getWorkspaceSetupState('imported-workspace').imported).toBe(true);
  });

  test('Settings re-entry shares the steps and does not navigate to separate AI settings', () => {
    updateWelcomeState({ showSetup: false });
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<NotaSetupSettings onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'import' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(getWorkspaceSetupState('local').finished).toBe(true);
    expect(getWelcomeState().showSetup).toBe(false);
  });

  test('closing setup clears the global resume request', () => {
    render(<WorkspaceSetup />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss setup' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getWelcomeState().showSetup).toBe(false);
    expect(getWorkspaceSetupState('local').finished).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.openDialog).not.toHaveBeenCalled();
  });

  test('a completed import in another workspace is not reported by Settings', () => {
    updateWelcomeState({ showSetup: false, imported: true });
    enterWorkspace('unrelated-workspace');
    updateWorkspaceSetupState(mocks.workspace.id, { setupStep: 'import' });
    render(<NotaSetupSettings onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByText('Import completed')).toBeNull();
  });

  test('an import chosen before launch opens the importer once', () => {
    updateWelcomeState({ showSetup: false, pendingImport: true });
    const view = render(<WorkspaceSetup />);
    expect(mocks.openDialog).toHaveBeenCalledExactlyOnceWith(
      'import',
      undefined,
      expect.any(Function)
    );
    expect(getWelcomeState().pendingImport).toBe(false);
    view.unmount();
    render(<WorkspaceSetup />);
    expect(mocks.openDialog).toHaveBeenCalledOnce();
  });

  test('a Drive copy chosen before launch copies the local workspace once', async () => {
    mocks.user = { sub: 'owner' };
    updateWelcomeState({ showSetup: false, pendingDrive: true });
    render(<WorkspaceSetup />);
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('drive-copy', 'all')
    );
    expect(mocks.toDrive).toHaveBeenCalledExactlyOnceWith(
      mocks.workspace,
      null,
      'google-drive'
    );
    expect(getWelcomeState().pendingDrive).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  test('a queued Drive copy is dropped for a workspace already in Drive', () => {
    enterWorkspace('drive-copy', 'google-drive');
    updateWelcomeState({
      showSetup: false,
      pendingDrive: true,
      pendingImport: true,
    });
    render(<WorkspaceSetup />);
    expect(mocks.toDrive).not.toHaveBeenCalled();
    expect(getWelcomeState().pendingDrive).toBe(false);
    expect(mocks.openDialog).toHaveBeenCalledOnce();
  });

  test('a failed queued Drive copy keeps the local workspace and still imports', async () => {
    mocks.user = { sub: 'owner' };
    mocks.toDrive.mockRejectedValue(new Error('Drive is full.'));
    updateWelcomeState({
      showSetup: false,
      pendingDrive: true,
      pendingImport: true,
    });
    render(<WorkspaceSetup />);
    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalledOnce());
    expect(mocks.notify.error.mock.calls[0][0].message).toContain(
      'Your local workspace is unchanged.'
    );
    expect(mocks.jump).not.toHaveBeenCalled();
    expect(mocks.openDialog).toHaveBeenCalledOnce();
  });

  test('a queued Drive copy without a Google session falls back to local', () => {
    vi.useFakeTimers();
    try {
      updateWelcomeState({ showSetup: false, pendingDrive: true });
      render(<WorkspaceSetup />);
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      expect(mocks.toDrive).not.toHaveBeenCalled();
      expect(mocks.notify).toHaveBeenCalledOnce();
      expect(getWelcomeState().pendingDrive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('unavailable preferences keep same-session progression and writing available', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    render(<WorkspaceSetup />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'drive' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'available for this session'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getWelcomeState().showSetup).toBe(false);
  });

  test('failed preference writes after a Drive copy do not invite another copy', async () => {
    enterWorkspace('failed-storage-source');
    updateWorkspaceSetupState(mocks.workspace.id, { setupStep: 'drive' });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    const view = render(<WorkspaceSetup />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('drive-copy', 'all')
    );
    view.unmount();
    enterWorkspace('drive-copy', 'google-drive');
    render(<WorkspaceSetup />);
    expect(screen.getByRole('heading', { name: 'transcription' })).toBeTruthy();
    expect(mocks.toDrive).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
  });
});
