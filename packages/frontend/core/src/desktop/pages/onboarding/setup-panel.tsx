import { ArrowLeftSmallIcon } from '@blocksuite/icons/rc';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { NOTA_LINKS } from '../../../utils/public-links';
import { NotaModelsSetup } from './models-setup';
import * as styles from './nota-welcome.css';
import { NotaPermissionsSetup } from './permissions-setup';
import type { SetupStep } from './setup-state';

const steps = [
  'Welcome',
  'Drive and login',
  'Transcription',
  'Chat',
  'Permissions',
  'Import',
];

export function NotaSetupProgress({ step }: { step: number }) {
  return (
    <nav aria-label="Setup progress">
      <ol className={styles.progress}>
        {steps.map((label, index) => (
          <li
            key={label}
            className={styles.progressStep}
            aria-current={step === index ? 'step' : undefined}
            data-complete={step > index}
          >
            {label}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function NotaPublicLinks() {
  return (
    <nav className={styles.footer} aria-label="Nota resources">
      <a href={NOTA_LINKS.source} target="_blank" rel="noreferrer">
        Open source on GitHub
      </a>
      <a href={NOTA_LINKS.docs} target="_blank" rel="noreferrer">
        Help
      </a>
      <a href={NOTA_LINKS.issues} target="_blank" rel="noreferrer">
        Report a problem
      </a>
    </nav>
  );
}

export interface SetupPanelProps {
  step: SetupStep;
  onStepChange: (step: SetupStep) => void;
  onFinish: () => void | Promise<void>;
  driveContent?: ReactNode;
  onImport: () => void | Promise<void>;
  imported?: boolean;
  focusHeading?: boolean;
  onBackToWelcome?: () => void;
  onChatSelected?: (id: string) => void | Promise<void>;
  onChatAction?: (
    id: string,
    action: 'download' | 'probe'
  ) => void | Promise<void>;
}

const descriptions: Record<SetupStep, string> = {
  models:
    'Choose the local model for chat and the model for transcription. You can set up either one now or come back later.',
  drive:
    'Sign in to Google to keep a synced copy in your own Drive. You can also keep using Nota entirely on this device.',
  transcription:
    'Choose the local model that turns meeting recordings into text. You can change this any time in Settings.',
  chat: 'Choose the local model for Nota AI, note actions, and meeting summaries.',
  permissions:
    'Allow meeting recording and calendar access only when you are ready. Writing stays available without either permission.',
  import:
    'Bring your existing notes and databases into Nota, or start with a fresh workspace.',
};
const stepIndex = {
  models: 1,
  drive: 1,
  transcription: 2,
  chat: 3,
  permissions: 4,
  import: 5,
};

export function NotaSetupPanel({
  step,
  onStepChange,
  onFinish,
  driveContent,
  onImport,
  imported = false,
  focusHeading = false,
  onBackToWelcome,
  onChatSelected,
  onChatAction,
}: SetupPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    setError(null);
    if (focusHeading) heading.current?.focus();
  }, [step, focusHeading]);
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      await onFinish();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setFinishing(false);
    }
  };
  const importContent = async () => {
    setError(null);
    try {
      await onImport();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const headingLabel = step === 'models' ? 'AI models' : steps[stepIndex[step]];
  const previous: Record<SetupStep, SetupStep | undefined> = {
    models: undefined,
    drive: onBackToWelcome ? 'models' : undefined,
    transcription: 'drive',
    chat: 'transcription',
    permissions: 'chat',
    import: 'permissions',
  };
  const previousStep = previous[step];
  const back = previousStep
    ? () => onStepChange(previousStep)
    : onBackToWelcome;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Nota</span>
        <button
          type="button"
          className={styles.subtle}
          onClick={() => void finish()}
          disabled={finishing}
        >
          Start working
        </button>
      </header>
      <NotaSetupProgress step={stepIndex[step]} />
      <div className={styles.panelTitleRow}>
        {back ? (
          <button
            type="button"
            className={styles.iconButton}
            onClick={back}
            aria-label="Back"
            title="Back"
          >
            <ArrowLeftSmallIcon />
          </button>
        ) : null}
        <h2 className={styles.panelHeading} tabIndex={-1} ref={heading}>
          {headingLabel}
        </h2>
      </div>
      <p className={styles.panelDescription}>{descriptions[step]}</p>
      <div className={styles.setupStage}>
        {step === 'models' ? (
          <NotaModelsSetup
            onContinue={() => onStepChange('drive')}
            onSkip={() => onStepChange('drive')}
            mode="all"
            onChatSelected={onChatSelected}
            onChatAction={onChatAction}
          />
        ) : step === 'drive' ? (
          <>
            {driveContent}
            <div className={styles.localDefault}>
              <span className={styles.localDot} aria-hidden="true" />
              Local writing works without a Google account.
            </div>
            <div className={styles.stageActions}>
              <button
                type="button"
                className={styles.subtle}
                onClick={() => onStepChange('transcription')}
              >
                Skip for now
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => onStepChange('transcription')}
              >
                Continue <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        ) : step === 'transcription' ? (
          <NotaModelsSetup
            mode="transcription"
            onContinue={() => onStepChange('chat')}
            onSkip={() => onStepChange('chat')}
            onChatSelected={onChatSelected}
            onChatAction={onChatAction}
          />
        ) : step === 'chat' ? (
          <NotaModelsSetup
            mode="chat"
            onContinue={() => onStepChange('permissions')}
            onSkip={() => onStepChange('permissions')}
            onChatSelected={onChatSelected}
            onChatAction={onChatAction}
          />
        ) : step === 'permissions' ? (
          <NotaPermissionsSetup
            onContinue={() => onStepChange('import')}
            onSkip={() => onStepChange('import')}
          />
        ) : (
          <>
            <div className={styles.setupContent}>
              <h3 className={styles.choiceTitle}>
                {imported
                  ? 'Your content is in Nota'
                  : 'Your notes, ready for a new home'}
              </h3>
              <p className={styles.detail}>
                {imported
                  ? 'Keep working with the pages you brought in, or import another file.'
                  : 'Choose a file. Nota shows the available import options and reports any content it cannot convert.'}
              </p>
              <ul
                className={styles.importPreview}
                aria-label="Supported formats"
              >
                <li className={styles.importSource}>Notion</li>
                <li className={styles.importSource}>Markdown</li>
                <li className={styles.importSource}>CSV</li>
                <li className={styles.importSource}>Nota backup</li>
              </ul>
              {imported ? (
                <p className={styles.detail} role="status">
                  Import complete
                </p>
              ) : null}
              <button
                type="button"
                className={styles.button}
                onClick={() => void importContent()}
              >
                {imported ? 'Import more content' : 'Choose a file to import'}
              </button>
            </div>
            <div className={styles.stageActions}>
              <button
                type="button"
                className={styles.subtle}
                onClick={() => void finish()}
                disabled={finishing}
              >
                Skip import
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void finish()}
                disabled={finishing}
              >
                Start working <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <NotaPublicLinks />
    </div>
  );
}
