import {
  AiIcon,
  ArrowLeftSmallIcon,
  ArrowRightSmallIcon,
  CloudWorkspaceIcon,
  DoneIcon,
  EditIcon,
  ImportIcon,
  LinkedPageIcon,
  LocalWorkspaceIcon,
  MeetingIcon,
  MicrophoneIcon,
  NotionIcon,
  PageIcon,
} from '@blocksuite/icons/rc';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import { useLiveData, useServiceOptional } from '@nota/infra';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { NotaModelsSetup } from './models-setup';
import * as shared from './nota-welcome.css';
import { NotaPermissionsSetup } from './permissions-setup';
import {
  getWelcomeState,
  type SetupStep,
  updateWelcomeState,
  useWelcomeState,
  type WelcomeState,
} from './setup-state';
import * as styles from './welcome-flow.css';

type Phase = 'intro' | 'setup' | 'done';
type CardStep = 'welcome' | Exclude<SetupStep, 'models'>;

const order: CardStep[] = [
  'welcome',
  'drive',
  'transcription',
  'chat',
  'permissions',
  'import',
];
const labels: Record<CardStep, string> = {
  welcome: 'Welcome',
  drive: 'Drive and login',
  transcription: 'Transcription',
  chat: 'Chat',
  permissions: 'Permissions',
  import: 'Import',
};
const titles: Record<CardStep, string> = {
  welcome: 'Welcome to Nota',
  drive: 'Sync with Google Drive',
  transcription: 'Meeting transcription',
  chat: 'Local AI chat',
  permissions: 'Recording and calendar',
  import: 'Bring your notes',
};
const copy: Record<CardStep, string> = {
  welcome:
    'A local-first workspace for your pages, meetings and AI. Everything starts on this device.',
  drive:
    'Sign in to keep a synced copy of your workspace in your own Google Drive.',
  transcription:
    'Choose the model that turns meeting recordings into text on this device.',
  chat: 'Choose the local model for Nota AI, note actions and meeting summaries.',
  permissions:
    'Allow recording and calendar access now, or later when you start a meeting.',
  import: 'Start with a fresh workspace, or bring pages over from another app.',
};
// The intro runs on CSS timing; these mark when it fades and hands over.
const INTRO_LEAVE_MS = 8_900;
const INTRO_END_MS = 9_400;
const READY_MS = 1_600;

function resumeStep(state: WelcomeState): CardStep {
  if (!state.introCompleted) return 'welcome';
  if (state.setupStep === 'models') return 'transcription';
  return state.setupStep ?? 'welcome';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

/**
 * First-launch experience: an animated introduction over the desktop, then
 * the complete setup in one card, then the workspace window opens.
 */
export function NotaWelcome({
  onOpenApp,
  desktopOverlay = false,
  onChatSelected,
}: {
  onOpenApp: () => void | Promise<void>;
  desktopOverlay?: boolean;
  onChatSelected?: (id: string) => void | Promise<void>;
}) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(() =>
    getWelcomeState().introCompleted ? 'setup' : 'intro'
  );
  const [introLeaving, setIntroLeaving] = useState(false);
  const [step, setStep] = useState<CardStep>(() =>
    resumeStep(getWelcomeState())
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  const openApp = useRef(onOpenApp);
  openApp.current = onOpenApp;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const endIntro = () => {
    updateWelcomeState({ introCompleted: true });
    setPhase('setup');
  };
  useEffect(() => {
    if (phase !== 'intro') return;
    if (reducedMotion) {
      endIntro();
      return;
    }
    const leave = window.setTimeout(
      () => setIntroLeaving(true),
      INTRO_LEAVE_MS
    );
    const end = window.setTimeout(endIntro, INTRO_END_MS);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(end);
    };
  }, [phase, reducedMotion]);

  const goTo = (next: CardStep) => {
    setStep(next);
    if (next !== 'welcome') updateWelcomeState({ setupStep: next });
  };
  const finish = () => {
    updateWelcomeState({
      introCompleted: true,
      showSetup: false,
      action: undefined,
    });
    setError(null);
    setPhase('done');
  };

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = window.setTimeout(
      () => {
        Promise.resolve()
          .then(() => openApp.current())
          .catch(reason => {
            if (active.current) setError(errorMessage(reason));
          });
      },
      reducedMotion ? 0 : READY_MS
    );
    return () => window.clearTimeout(timer);
  }, [phase, attempt, reducedMotion]);

  return (
    <main
      className={styles.screen}
      data-phase={phase}
      data-reduced-motion={reducedMotion}
      data-desktop-overlay={desktopOverlay}
    >
      <div className={styles.backdrop} data-desktop-overlay={desktopOverlay} />
      {phase === 'intro' ? (
        <>
          <Intro leaving={introLeaving} />
          <button type="button" className={styles.skip} onClick={endIntro}>
            Skip intro
          </button>
        </>
      ) : null}
      {phase !== 'intro' ? (
        <div className={styles.stage}>
          <SetupCard
            step={step}
            leaving={phase === 'done'}
            onStep={goTo}
            onFinish={finish}
            onChatSelected={onChatSelected}
          />
        </div>
      ) : null}
      {phase === 'done' ? (
        <section className={styles.ready} aria-live="polite">
          <h1 className={styles.readyTitle}>Your workspace is ready.</h1>
          {error ? (
            <div className={styles.readyError}>
              <p className={shared.error} role="alert">
                {error}
              </p>
              <button
                type="button"
                className={shared.button}
                onClick={() => {
                  setError(null);
                  setAttempt(value => value + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function Intro({ leaving }: { leaving: boolean }) {
  return (
    <div className={styles.intro} data-leaving={leaving} aria-hidden="true">
      <div className={styles.horizon} />
      <div className={styles.stroke} />
      <div className={styles.lockup}>
        <img src="/favicon-192.png" alt="" className={styles.lockupMark} />
        <span className={styles.lockupWordmark}>Nota</span>
      </div>
      <div className={styles.vignettes}>
        <div className={styles.floatPage}>
          <span className={styles.floatLine} />
          <span className={styles.floatLine} />
          <span className={styles.floatLine} />
          <span className={styles.floatLine} />
        </div>
        <span className={styles.chip} data-chip="meeting">
          <span className={styles.recordingDot} />
          Transcribing on this device
        </span>
        <span className={styles.chip} data-chip="linked">
          <LinkedPageIcon />
          Linked to Q4 plan
        </span>
        <span className={styles.chip} data-chip="local">
          <LocalWorkspaceIcon />
          Saved locally
        </span>
        <div className={styles.askBar}>
          <div className={styles.askText}>
            <span className={styles.askPhrase} data-phrase="0">
              Summarize this meeting
            </span>
            <span className={styles.askPhrase} data-phrase="1">
              Link this to my project notes
            </span>
            <span className={styles.askPhrase} data-phrase="2">
              Draft a follow-up from my notes
            </span>
          </div>
          <span className={styles.askSend}>
            <ArrowRightSmallIcon />
          </span>
        </div>
      </div>
    </div>
  );
}

function SetupCard({
  step,
  leaving,
  onStep,
  onFinish,
  onChatSelected,
}: {
  step: CardStep;
  leaving: boolean;
  onStep: (step: CardStep) => void;
  onFinish: () => void;
  onChatSelected?: (id: string) => void | Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const index = order.indexOf(step);
  const next = () =>
    index < order.length - 1 ? onStep(order[index + 1]) : onFinish();
  const back = index > 0 ? () => onStep(order[index - 1]) : undefined;
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  // Enter continues from anywhere that is not itself a control.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label')) return;
    if (!primary.current || primary.current.disabled) return;
    event.preventDefault();
    primary.current.click();
  };

  let content: ReactNode;
  if (step === 'welcome') {
    content = (
      <WelcomeStep primary={primary} onNext={next} onSkipAll={onFinish} />
    );
  } else if (step === 'drive') {
    content = <DriveStep primary={primary} onNext={next} />;
  } else if (step === 'transcription' || step === 'chat') {
    content = (
      <NotaModelsSetup
        key={step}
        mode={step}
        onContinue={next}
        onSkip={next}
        onChatSelected={onChatSelected}
      />
    );
  } else if (step === 'permissions') {
    content = <NotaPermissionsSetup onContinue={next} onSkip={next} />;
  } else {
    content = <ImportStep primary={primary} onFinish={onFinish} />;
  }
  const hasPreview = step !== 'permissions';

  return (
    <div
      className={styles.card}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nota-setup-title"
      aria-hidden={leaving || undefined}
      data-leaving={leaving}
      style={leaving ? { pointerEvents: 'none' } : undefined}
      onKeyDown={onKeyDown}
    >
      <div
        className={styles.cardProgress}
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={order.length}
        aria-valuenow={index + 1}
        aria-valuetext={`Step ${index + 1} of ${order.length}: ${labels[step]}`}
      >
        <span
          className={styles.cardProgressFill}
          style={{ width: `${((index + 1) / order.length) * 100}%` }}
        />
      </div>
      <div className={styles.cardBody} data-preview={hasPreview}>
        <div className={styles.cardMain}>
          <div className={styles.cardTitleRow}>
            {back ? (
              <button
                type="button"
                className={shared.iconButton}
                onClick={back}
                aria-label="Back"
                title="Back"
              >
                <ArrowLeftSmallIcon />
              </button>
            ) : null}
            <h1
              id="nota-setup-title"
              className={styles.cardTitle}
              tabIndex={-1}
              ref={heading}
            >
              {titles[step]}
            </h1>
          </div>
          <p className={styles.cardCopy}>{copy[step]}</p>
          <div className={styles.cardStage} key={step}>
            {content}
          </div>
        </div>
        {hasPreview ? <Preview step={step} /> : null}
      </div>
    </div>
  );
}

function Enter() {
  return (
    <span className={styles.enterHint} aria-hidden="true">
      ↵
    </span>
  );
}

function WelcomeStep({
  primary,
  onNext,
  onSkipAll,
}: {
  primary: RefObject<HTMLButtonElement | null>;
  onNext: () => void;
  onSkipAll: () => void;
}) {
  return (
    <>
      <ul className={styles.features}>
        <li className={styles.feature}>
          <span className={styles.featureIcon}>
            <EditIcon />
          </span>
          <span>
            <strong>Write</strong>
            Pages, databases and linked notes, saved on your device.
          </span>
        </li>
        <li className={styles.feature}>
          <span className={styles.featureIcon}>
            <MicrophoneIcon />
          </span>
          <span>
            <strong>Record</strong>
            Meetings transcribed by a model running on this computer.
          </span>
        </li>
        <li className={styles.feature}>
          <span className={styles.featureIcon}>
            <AiIcon />
          </span>
          <span>
            <strong>Ask</strong>
            Chat with a local AI about your pages and meetings.
          </span>
        </li>
      </ul>
      <div className={shared.bottom}>
        <button type="button" className={shared.subtle} onClick={onSkipAll}>
          Skip setup
        </button>
        <button
          type="button"
          className={shared.primary}
          ref={primary}
          onClick={onNext}
        >
          Let&apos;s go <Enter />
        </button>
      </div>
    </>
  );
}

function DriveStep({
  primary,
  onNext,
}: {
  primary: RefObject<HTMLButtonElement | null>;
  onNext: () => void;
}) {
  const auth = useServiceOptional(GoogleAuthService);
  const user = useLiveData(auth?.session.userInfo$ ?? null);
  const state = useWelcomeState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.connect();
      updateWelcomeState({ pendingDrive: true });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError'))
        setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!auth ? (
        <p className={shared.detail}>
          Google Drive sync is available later in Settings.
        </p>
      ) : user ? (
        <>
          <div className={styles.account}>
            <span className={styles.accountBadge}>
              <DoneIcon />
            </span>
            <span>Signed in as {user.email}</span>
          </div>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={state.pendingDrive === true}
              onChange={event =>
                updateWelcomeState({ pendingDrive: event.target.checked })
              }
            />
            <span>
              <strong>Keep a synced copy in Drive</strong>
              Nota copies your workspace to your Drive when it opens. The
              original stays on this device.
            </span>
          </label>
        </>
      ) : (
        <div className={shared.actions}>
          <button
            type="button"
            className={shared.button}
            disabled={busy}
            onClick={() => void connect()}
          >
            <CloudWorkspaceIcon />
            {busy ? 'Waiting for Google…' : 'Sign in with Google'}
          </button>
        </div>
      )}
      <div className={shared.localDefault}>
        <span className={shared.localDot} aria-hidden="true" />
        Local writing works without a Google account.
      </div>
      {error ? (
        <p className={shared.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={shared.bottom}>
        <button type="button" className={shared.subtle} onClick={onNext}>
          Skip for now
        </button>
        <button
          type="button"
          className={shared.primary}
          ref={primary}
          onClick={onNext}
        >
          Continue <Enter />
        </button>
      </div>
    </>
  );
}

function ImportStep({
  primary,
  onFinish,
}: {
  primary: RefObject<HTMLButtonElement | null>;
  onFinish: () => void;
}) {
  const state = useWelcomeState();
  const importing = state.pendingImport === true;
  return (
    <>
      <fieldset className={styles.options} aria-label="How to start">
        <label className={styles.option}>
          <input
            type="radio"
            name="nota-start"
            checked={!importing}
            onChange={() => updateWelcomeState({ pendingImport: false })}
          />
          <span>
            <strong>Start fresh</strong>
            Open a new workspace and write your first page.
          </span>
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name="nota-start"
            checked={importing}
            onChange={() => updateWelcomeState({ pendingImport: true })}
          />
          <span>
            <strong>Import my notes</strong>
            Nota opens the importer for Notion, Markdown, CSV or a Nota backup
            when your workspace opens.
          </span>
        </label>
      </fieldset>
      <div className={shared.bottom}>
        <span />
        <button
          type="button"
          className={shared.primary}
          ref={primary}
          onClick={onFinish}
        >
          Start working <Enter />
        </button>
      </div>
    </>
  );
}

function PreviewLines() {
  return (
    <>
      <span className={styles.previewLine} data-width="l" />
      <span className={styles.previewLine} data-width="m" />
      <span className={styles.previewLine} data-width="l" />
      <span className={styles.previewLine} data-width="s" />
    </>
  );
}

function Preview({ step }: { step: CardStep }) {
  let page: ReactNode;
  if (step === 'drive') {
    page = (
      <>
        <div className={styles.previewHeading}>Workspace</div>
        <span className={styles.previewChip}>
          <CloudWorkspaceIcon />
          Synced to Google Drive
        </span>
        <span className={styles.previewChip}>
          <LocalWorkspaceIcon />
          Saved on this device
        </span>
        <PreviewLines />
      </>
    );
  } else if (step === 'transcription') {
    page = (
      <>
        <span className={styles.previewChip}>
          <MeetingIcon />
          Weekly sync · 12:04
        </span>
        <div className={styles.previewWave}>
          {Array.from({ length: 16 }, (_, bar) => (
            <span key={bar} />
          ))}
        </div>
        <div className={styles.previewBubble}>
          Maya: Let&apos;s ship the beta on Friday.
        </div>
        <div className={styles.previewBubble}>
          Sam: I&apos;ll update the release notes today.
        </div>
      </>
    );
  } else if (step === 'chat') {
    page = (
      <>
        <div className={styles.previewBubble} data-from="me">
          Summarize my meeting notes
        </div>
        <div className={styles.previewBubble}>
          Three decisions: ship Friday, update the notes, review pricing next
          week.
        </div>
        <span className={styles.previewChip}>
          <AiIcon />
          Running on this device
        </span>
      </>
    );
  } else if (step === 'import') {
    page = (
      <>
        <div className={styles.previewHeading}>Import</div>
        <div className={styles.previewFile}>
          <NotionIcon />
          Notion export.zip
          <small>142 pages</small>
        </div>
        <div className={styles.previewFile}>
          <PageIcon />
          Research.md
          <small>Markdown</small>
        </div>
        <div className={styles.previewFile}>
          <ImportIcon />
          Reading list.csv
          <small>Database</small>
        </div>
      </>
    );
  } else {
    page = (
      <>
        <div className={styles.previewHeading}>Project notes</div>
        <PreviewLines />
        <span className={styles.previewChip}>
          <LinkedPageIcon />
          Linked to Q4 plan
        </span>
        <div className={styles.previewBubble} data-from="me">
          What did we decide about the beta?
        </div>
      </>
    );
  }
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewWindow} key={step}>
        <div className={styles.previewBar}>
          <i />
          <i />
          <i />
          <span style={{ marginLeft: 8 }}>Nota</span>
        </div>
        <div className={styles.previewLayout}>
          <div className={styles.previewSidebar}>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.previewPage}>{page}</div>
        </div>
      </div>
    </div>
  );
}
