import { useSyncExternalStore } from 'react';

import type { LocalStarterTemplateId } from '../../../modules/template-doc/services/starter-templates';

export type SetupChoice = 'ai' | 'meetings' | 'drive' | 'import';
/**
 * The setup wizard is intentionally resumable. `models` is retained as a
 * legacy value so an older interrupted wizard can still be opened; new
 * sessions always begin with Drive and then use the focused model screens.
 */
export type SetupStep =
  | 'models'
  | 'drive'
  | 'transcription'
  | 'chat'
  | 'permissions'
  | 'import';
export type SetupAction =
  | { choice: SetupChoice }
  | { choice: 'workspace'; template: LocalStarterTemplateId | 'blank' }
  | { choice: 'draft'; title: string; text: string; linked: boolean };
export interface PracticeDraft {
  title: string;
  text: string;
  linked: boolean;
}
export interface WelcomeState {
  introCompleted?: boolean;
  showSetup?: boolean;
  action?: SetupAction;
  deferred?: SetupChoice[];
  step?: 0 | 1 | 2;
  draft?: PracticeDraft;
  setupStep?: SetupStep;
  imported?: boolean;
  /** Chosen in the welcome window; the workspace copies to Drive on open. */
  pendingDrive?: boolean;
  /** Chosen in the welcome window; the workspace opens Import on open. */
  pendingImport?: boolean;
}
export interface WorkspaceSetupState {
  deferred?: SetupChoice[];
  starterDocId?: string;
  starterTitle?: string;
  draftLinkedDocId?: string;
  imported?: boolean;
  finished?: boolean;
  setupStep?: SetupStep;
}

const WELCOME_KEY = 'nota-welcome:v1';
const CHANGE_EVENT = 'nota-setup-state-changed';
const fallback = new Map<string, string>();
const snapshots = new Map<string, { raw: string | null; value: object }>();
const workspaceKey = (id: string) => `nota-workspace-setup:v1:${id}`;
const choices = new Set(['ai', 'meetings', 'drive', 'import']);

function parseState(candidate: Record<string, unknown>) {
  const value: Record<string, unknown> = {};
  for (const key of [
    'introCompleted',
    'showSetup',
    'imported',
    'finished',
    'pendingDrive',
    'pendingImport',
  ]) {
    if (typeof candidate[key] === 'boolean') value[key] = candidate[key];
  }
  for (const key of ['starterDocId', 'starterTitle', 'draftLinkedDocId']) {
    if (typeof candidate[key] === 'string') value[key] = candidate[key];
  }
  if (candidate.step === 0 || candidate.step === 1 || candidate.step === 2)
    value.step = candidate.step;
  if (
    candidate.setupStep === 'models' ||
    candidate.setupStep === 'drive' ||
    candidate.setupStep === 'transcription' ||
    candidate.setupStep === 'chat' ||
    candidate.setupStep === 'permissions' ||
    candidate.setupStep === 'import'
  )
    value.setupStep = candidate.setupStep;
  const draft = candidate.draft as Partial<PracticeDraft> | undefined;
  if (
    draft &&
    typeof draft.title === 'string' &&
    typeof draft.text === 'string'
  )
    value.draft = {
      title: draft.title,
      text: draft.text,
      linked: draft.linked === true,
    };
  if (Array.isArray(candidate.deferred)) {
    value.deferred = [
      ...new Set(candidate.deferred.filter(item => choices.has(item))),
    ];
  }
  const action = candidate.action as Partial<SetupAction> | undefined;
  if (action && choices.has(action.choice ?? '')) {
    value.action = { choice: action.choice };
  } else if (
    action?.choice === 'workspace' &&
    typeof action.template === 'string'
  ) {
    value.action = { choice: action.choice, template: action.template };
  } else if (
    action?.choice === 'draft' &&
    typeof action.title === 'string' &&
    typeof action.text === 'string'
  ) {
    value.action = {
      choice: 'draft',
      title: action.title,
      text: action.text,
      linked: action.linked === true,
    };
  }
  return value;
}

function read<T extends object>(key: string): T {
  let raw = fallback.get(key) ?? null;
  try {
    raw = fallback.get(key) ?? localStorage.getItem(key);
  } catch {
    // Setup preferences must never prevent access to a workspace.
  }
  const cached = snapshots.get(key);
  if (cached?.raw === raw) return cached.value as T;
  let value: object = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      value = parseState(parsed as Record<string, unknown>);
    }
  } catch {
    // A malformed preference does not affect local content.
  }
  snapshots.set(key, { raw, value });
  return value as T;
}

function patch<T extends object>(key: string, change: Partial<T>) {
  const raw = JSON.stringify({ ...read<T>(key), ...change });
  let persisted = false;
  try {
    localStorage.setItem(key, raw);
    fallback.delete(key);
    persisted = true;
  } catch {
    // Keep the current session usable when browser preferences are unavailable.
    fallback.set(key, raw);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return persisted;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export const getWelcomeState = () => read<WelcomeState>(WELCOME_KEY);
export const updateWelcomeState = (change: Partial<WelcomeState>) =>
  patch<WelcomeState>(WELCOME_KEY, change);
export const getWorkspaceSetupState = (id: string) =>
  read<WorkspaceSetupState>(workspaceKey(id));
export const updateWorkspaceSetupState = (
  id: string,
  change: Partial<WorkspaceSetupState>
) => patch<WorkspaceSetupState>(workspaceKey(id), change);

export const useWelcomeState = () =>
  useSyncExternalStore(subscribe, getWelcomeState, getWelcomeState);
export const useWorkspaceSetupState = (id: string) =>
  useSyncExternalStore(
    subscribe,
    () => getWorkspaceSetupState(id),
    () => getWorkspaceSetupState(id)
  );
