import type { NamespaceHandlers } from '../type';
import { GOOGLE_SESSION_STORAGE_KEY } from '../windows-manager/google-calendar-scheduler';
import {
  clearGlobalCacheBroadcastRevisions,
  clearGlobalStateBroadcastRevisions,
  globalCacheUpdates$,
  globalStateUpdates$,
  publishGlobalCacheUpdateFromMain,
  publishGlobalStateUpdateFromMain,
} from './broadcast';
import { globalCacheStorage, globalStateStorage } from './storage';

const GOOGLE_SESSION_PUBLIC_STATE_KEY = 'nota-google-session-state:v1';

function rejectLegacyGoogleSessionMutation(key: string) {
  if (key.startsWith('nota:local-backups:v1:')) {
    throw new Error(
      'Local backup preferences can only be changed through backup settings.'
    );
  }
  if (
    key === GOOGLE_SESSION_STORAGE_KEY ||
    key === GOOGLE_SESSION_PUBLIC_STATE_KEY
  ) {
    throw new Error(
      'Google session state can only be changed through the authenticated Google API.'
    );
  }
}

export const sharedStorageHandlers = {
  getAllGlobalState: async () => {
    const state = { ...globalStateStorage.all() };
    // OAuth tokens live in Electron safeStorage and must never be included in
    // the generic state snapshot shared with every renderer window.
    delete state[GOOGLE_SESSION_STORAGE_KEY];
    return state;
  },
  getAllGlobalCache: async () => {
    return globalCacheStorage.all();
  },

  setGlobalState: async (_e, key: string, value: any, sourceId?: string) => {
    rejectLegacyGoogleSessionMutation(key);
    globalStateStorage.set(key, value);
    publishGlobalStateUpdateFromMain(key, value, sourceId);
  },
  delGlobalState: async (_e, key: string, sourceId?: string) => {
    rejectLegacyGoogleSessionMutation(key);
    globalStateStorage.del(key);
    publishGlobalStateUpdateFromMain(key, undefined, sourceId);
  },
  clearGlobalState: async (_e, sourceId?: string) => {
    const legacyGoogleSession = globalStateStorage.get(
      GOOGLE_SESSION_STORAGE_KEY
    );
    const googleSessionPublicState = globalStateStorage.get(
      GOOGLE_SESSION_PUBLIC_STATE_KEY
    );
    clearGlobalStateBroadcastRevisions();
    globalStateStorage.clear();
    // A generic state reset must not mutate credentials waiting for one-way
    // secure migration or erase the public marker for the secure session.
    if (legacyGoogleSession !== undefined) {
      globalStateStorage.set(GOOGLE_SESSION_STORAGE_KEY, legacyGoogleSession);
    }
    if (googleSessionPublicState !== undefined) {
      globalStateStorage.set(
        GOOGLE_SESSION_PUBLIC_STATE_KEY,
        googleSessionPublicState
      );
    }
    globalStateUpdates$.next({ '*': { v: undefined, r: 0, s: sourceId } });
    if (googleSessionPublicState !== undefined) {
      publishGlobalStateUpdateFromMain(
        GOOGLE_SESSION_PUBLIC_STATE_KEY,
        googleSessionPublicState
      );
    }
  },

  setGlobalCache: async (_e, key: string, value: any, sourceId?: string) => {
    globalCacheStorage.set(key, value);
    publishGlobalCacheUpdateFromMain(key, value, sourceId);
  },
  delGlobalCache: async (_e, key: string, sourceId?: string) => {
    globalCacheStorage.del(key);
    publishGlobalCacheUpdateFromMain(key, undefined, sourceId);
  },
  clearGlobalCache: async (_e, sourceId?: string) => {
    clearGlobalCacheBroadcastRevisions();
    globalCacheStorage.clear();
    globalCacheUpdates$.next({ '*': { v: undefined, r: 0, s: sourceId } });
  },
} satisfies NamespaceHandlers;
