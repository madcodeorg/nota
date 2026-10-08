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
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: undefined as
    | undefined
    | { connect: () => Promise<void>; session: { userInfo$: object } },
  user: null as null | { email: string },
}));
vi.mock('@nota/core/modules/google-auth', () => ({
  GoogleAuthService: class {},
}));
vi.mock('@nota/infra', () => ({
  useServiceOptional: () => mocks.auth,
  useLiveData: () => mocks.user,
}));
vi.mock('./models-setup', () => ({
  NotaModelsSetup: ({
    onContinue,
    onSkip,
    mode = 'all',
  }: {
    onContinue: () => void;
    onSkip?: () => void;
    mode?: 'all' | 'chat' | 'transcription';
  }) => (
    <div>
      {mode !== 'transcription' ? (
        <label>
          Local chat model
          <select aria-label="Local chat model">
            <option>Chat model</option>
          </select>
        </label>
      ) : null}
      {mode !== 'chat' ? (
        <label>
          Transcription model
          <select aria-label="Transcription model">
            <option>Speech model</option>
          </select>
        </label>
      ) : null}
      <button type="button" onClick={onContinue}>
        Save and continue
      </button>
      <button type="button" onClick={onSkip}>
        Skip for now
      </button>
    </div>
  ),
}));
vi.mock('./permissions-setup', () => ({
  NotaPermissionsSetup: ({
    onContinue,
    onSkip,
  }: {
    onContinue: () => void;
    onSkip: () => void;
  }) => (
    <div>
      <button type="button" onClick={onContinue}>
        Continue permissions
      </button>
      <button type="button" onClick={onSkip}>
        Skip permissions
      </button>
    </div>
  ),
}));

import { NotaWelcome } from './nota-welcome';
import { NotaSetupPanel } from './setup-panel';
import {
  getWelcomeState,
  type SetupStep,
  updateWelcomeState,
} from './setup-state';

function Wizard({
  onFinish = vi.fn(),
  onImport = vi.fn(),
}: {
  onFinish?: () => void;
  onImport?: () => void;
}) {
  const [step, setStep] = useState<SetupStep>('drive');
  return (
    <NotaSetupPanel
      step={step}
      onStepChange={setStep}
      onFinish={onFinish}
      onImport={onImport}
      focusHeading
      driveContent={<button type="button">Connect Google Drive</button>}
    />
  );
}

describe('Nota welcome and sequential setup', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.auth = undefined;
    mocks.user = null;
    updateWelcomeState({
      introCompleted: false,
      showSetup: false,
      action: undefined,
      setupStep: undefined,
      imported: false,
      draft: undefined,
      step: 0,
      pendingDrive: undefined,
      pendingImport: undefined,
    });
    vi.stubGlobal('fetch', vi.fn());
    reduceMotion(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    updateWelcomeState({
      introCompleted: false,
      showSetup: false,
      setupStep: undefined,
      action: undefined,
      draft: undefined,
      pendingDrive: undefined,
      pendingImport: undefined,
    });
  });

  const reduceMotion = (matches: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
  const startAtCard = () => updateWelcomeState({ introCompleted: true });
  const progress = () =>
    screen.getByRole('progressbar', { name: 'Setup progress' });

  test('the intro plays over the desktop before the setup card', () => {
    render(<NotaWelcome onOpenApp={vi.fn()} desktopOverlay />);
    const main = screen.getByRole('main');
    expect(main.dataset.desktopOverlay).toBe('true');
    expect(main.dataset.phase).toBe('intro');
    expect(screen.getByRole('button', { name: 'Skip intro' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('Skip intro opens the setup card and remembers the intro', () => {
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(screen.getByRole('heading', { name: 'Welcome to Nota' })).toBe(
      document.activeElement
    );
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(
      'nota-setup-title'
    );
    expect(getWelcomeState().introCompleted).toBe(true);
  });

  test('the intro hands over to the card on its own', async () => {
    vi.useFakeTimers();
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    await act(async () => vi.advanceTimersByTime(9_400));
    expect(screen.getByRole('main').dataset.phase).toBe('setup');
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull();
    expect(getWelcomeState().introCompleted).toBe(true);
  });

  test('reduced motion goes straight to the setup card', () => {
    reduceMotion(true);
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(screen.getByRole('main').dataset.reducedMotion).toBe('true');
    expect(
      screen.getByRole('heading', { name: 'Welcome to Nota' })
    ).toBeTruthy();
  });

  test('setup happens inside the card, step by step, with Back', () => {
    startAtCard();
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(progress().getAttribute('aria-valuenow')).toBe('1');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Let's go/ }));
    expect(
      screen.getByRole('heading', { name: 'Sync with Google Drive' })
    ).toBe(document.activeElement);
    expect(progress().getAttribute('aria-valuetext')).toBe(
      'Step 2 of 6: Drive and login'
    );
    expect(getWelcomeState().setupStep).toBe('drive');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(
      screen.getByRole('heading', { name: 'Meeting transcription' })
    ).toBeTruthy();
    expect(screen.getByLabelText('Transcription model')).toBeTruthy();
    expect(screen.queryByLabelText('Local chat model')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('heading', { name: 'Local AI chat' })).toBeTruthy();
    expect(screen.getByLabelText('Local chat model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(
      screen.getByRole('heading', { name: 'Recording and calendar' })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue permissions' })
    );
    expect(
      screen.getByRole('heading', { name: 'Bring your notes' })
    ).toBeTruthy();
    expect(progress().getAttribute('aria-valuenow')).toBe('6');
    expect(getWelcomeState().setupStep).toBe('import');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'Recording and calendar' })
    ).toBeTruthy();
    expect(getWelcomeState().setupStep).toBe('permissions');
  });

  test('an interrupted setup resumes on its saved step', () => {
    updateWelcomeState({ introCompleted: true, setupStep: 'chat' });
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Local AI chat' })).toBeTruthy();
  });

  test('a legacy models step resumes on transcription', () => {
    updateWelcomeState({ introCompleted: true, setupStep: 'models' });
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(
      screen.getByRole('heading', { name: 'Meeting transcription' })
    ).toBeTruthy();
  });

  test('Drive without sign-in support explains it is available later', () => {
    updateWelcomeState({ introCompleted: true, setupStep: 'drive' });
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(
      screen.getByText('Google Drive sync is available later in Settings.')
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Sign in with Google' })
    ).toBeNull();
  });

  test('signing in with Google queues a Drive copy for the workspace', async () => {
    const connect = vi.fn(async () => {
      mocks.user = { email: 'kunj@example.com' };
    });
    mocks.auth = { connect, session: { userInfo$: {} } };
    updateWelcomeState({ introCompleted: true, setupStep: 'drive' });
    const view = render(<NotaWelcome onOpenApp={vi.fn()} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with Google' })
    );
    await waitFor(() => expect(getWelcomeState().pendingDrive).toBe(true));
    expect(connect).toHaveBeenCalledOnce();
    view.rerender(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(screen.getByText('Signed in as kunj@example.com')).toBeTruthy();
    const copy = screen.getByRole('checkbox', {
      name: /Keep a synced copy in Drive/,
    });
    expect((copy as HTMLInputElement).checked).toBe(true);
    fireEvent.click(copy);
    expect(getWelcomeState().pendingDrive).toBe(false);
  });

  test('a failed Google sign-in stays on the Drive step with an alert', async () => {
    mocks.auth = {
      connect: vi.fn().mockRejectedValue(new Error('Sign-in was cancelled')),
      session: { userInfo$: {} },
    };
    updateWelcomeState({ introCompleted: true, setupStep: 'drive' });
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with Google' })
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sign-in was cancelled'
    );
    expect(getWelcomeState().pendingDrive).toBeUndefined();
  });

  test('choosing Import queues the importer for the workspace', () => {
    updateWelcomeState({ introCompleted: true, setupStep: 'import' });
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    expect(
      (screen.getByRole('radio', { name: /Start fresh/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Import my notes/ }));
    expect(getWelcomeState().pendingImport).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Start fresh/ }));
    expect(getWelcomeState().pendingImport).toBe(false);
  });

  test('finishing shows the ready line, then opens the workspace', async () => {
    vi.useFakeTimers();
    const open = vi.fn();
    updateWelcomeState({
      introCompleted: true,
      showSetup: true,
      setupStep: 'import',
    });
    render(<NotaWelcome onOpenApp={open} />);
    fireEvent.click(screen.getByRole('button', { name: /Start working/ }));
    expect(
      screen.getByRole('heading', { name: 'Your workspace is ready.' })
    ).toBeTruthy();
    expect(getWelcomeState().showSetup).toBe(false);
    expect(open).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1_600));
    expect(open).toHaveBeenCalledOnce();
  });

  test('Skip setup on the welcome step opens the workspace', async () => {
    reduceMotion(true);
    const open = vi.fn();
    render(<NotaWelcome onOpenApp={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(getWelcomeState().showSetup).toBe(false);
  });

  test('a failed handoff shows the error and can be retried', async () => {
    reduceMotion(true);
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('Workspace could not open'))
      .mockResolvedValueOnce(undefined);
    render(<NotaWelcome onOpenApp={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Workspace could not open'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('Enter on the card continues to the next step', () => {
    startAtCard();
    render(<NotaWelcome onOpenApp={vi.fn()} />);
    fireEvent.keyDown(
      screen.getByRole('heading', { name: 'Welcome to Nota' }),
      {
        key: 'Enter',
      }
    );
    expect(
      screen.getByRole('heading', { name: 'Sync with Google Drive' })
    ).toBeTruthy();
  });

  test('setup keeps Drive, models, permissions, and import as separate steps', () => {
    const importContent = vi.fn();
    render(<Wizard onImport={importContent} />);
    expect(screen.getByRole('heading', { name: 'Drive and login' })).toBe(
      document.activeElement
    );
    // Without a welcome screen to return to, Drive is the first step.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    ).toBeTruthy();
    expect(importContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Transcription' })).toBeTruthy();
    expect(screen.getByLabelText('Transcription model')).toBeTruthy();
    expect(screen.queryByLabelText('Local chat model')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByLabelText('Local chat model')).toBeTruthy();
    expect(screen.queryByLabelText('Transcription model')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('heading', { name: 'Permissions' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue permissions' })
    );
    expect(screen.getByRole('heading', { name: 'Import' })).toBe(
      document.activeElement
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose a file to import' })
    );
    expect(importContent).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Permissions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy();
  });

  test('skipping optional steps does not start import or delay local writing', async () => {
    const finish = vi.fn();
    const importContent = vi.fn();
    render(<Wizard onFinish={finish} onImport={importContent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip permissions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip import' }));
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect(importContent).not.toHaveBeenCalled();
  });

  test('malformed persisted setup steps cannot select an unknown screen', () => {
    localStorage.setItem(
      'nota-welcome:v1',
      JSON.stringify({ setupStep: 'unknown', imported: true })
    );
    expect(getWelcomeState().setupStep).toBeUndefined();
    expect(getWelcomeState().imported).toBe(true);
  });
});
