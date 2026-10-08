import 'fake-indexeddb/auto';

import { type FrameworkProvider, LiveData } from '@nota/infra';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  getGoogleDriveWorkspaceIds,
  getGoogleDriveWorkspaceOwner,
  GoogleDriveWorkspaceFlavourProvider,
  isGoogleDriveWorkspaceSyncPaused,
  setGoogleDriveWorkspaceSyncPaused,
} from './google-drive';

const providers: GoogleDriveWorkspaceFlavourProvider[] = [];
beforeEach(() => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ files: [] }))
  );
});
function provider(accountId: string | null = null) {
  const auth = {
    session: {
      userInfo$: new LiveData(accountId ? { sub: accountId } : null),
      getTokensSnapshot: () => ({
        accessToken: 'access',
        expiresAt: Date.now() + 3600000,
      }),
      getAccessToken: vi.fn().mockResolvedValue('access'),
    },
  };
  const instance = new GoogleDriveWorkspaceFlavourProvider({
    get: () => auth,
  } as unknown as FrameworkProvider);
  providers.push(instance);
  return { instance, auth };
}
afterEach(async () => {
  providers.splice(0).forEach(provider => provider.dispose());
  await new Promise(resolve => setTimeout(resolve, 0));
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function cache(id = 'cached', accountId?: string) {
  localStorage.setItem('nota-google-drive-workspaces', JSON.stringify([id]));
  localStorage.setItem(
    'nota-google-drive-workspace-metadata',
    JSON.stringify({ [id]: { id, accountId, name: 'Cached workspace' } })
  );
}

describe('Drive workspace cache ownership', () => {
  test('cached workspaces remain visible with local storage initialized after logout', () => {
    cache('cached', 'account-A');
    const { instance } = provider();
    const subscription = instance.workspaces$.subscribe();
    expect(instance.workspaces$.value).toEqual([
      { id: 'cached', flavour: 'google-drive' },
    ]);
    const init = instance.getEngineWorkerInitOptions('cached');
    expect(init.local.doc?.opts).toMatchObject({
      flavour: 'google-drive',
      id: 'cached',
    });
    expect(init.remotes['google-drive'].doc?.opts).toMatchObject({
      accountId: 'account-A',
      tokens: null,
    });
    subscription.unsubscribe();
  });

  test('another account cannot upload an old cached workspace, and unowned legacy caches are never implicitly bound', () => {
    cache('cached', 'account-A');
    const { instance } = provider('account-B');
    expect(
      instance.getEngineWorkerInitOptions('cached').remotes['google-drive'].doc
        ?.opts
    ).toMatchObject({ accountId: 'account-A', tokens: null });
    cache('legacy');
    expect(
      instance.getEngineWorkerInitOptions('legacy').remotes['google-drive'].blob
        ?.opts
    ).toMatchObject({ accountId: undefined, tokens: null });
    expect(getGoogleDriveWorkspaceOwner('legacy')).toBeUndefined();
  });

  test('an account switch after local publication cannot upload the former owner metadata into the new account', async () => {
    const { instance, auth } = provider();
    auth.session.userInfo$.next({ sub: 'account-A' });
    const original = localStorage.setItem.bind(localStorage);
    let switched = false;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      original(key, value);
      if (key === 'nota-google-drive-workspace-metadata' && !switched) {
        switched = true;
        auth.session.userInfo$.next({ sub: 'account-B' });
        instance.onSessionChanged();
      }
    });
    const fetch = vi.fn(async () => Response.json({ files: [] }));
    vi.stubGlobal('fetch', fetch);
    const metadata = await instance.createWorkspace(async collection => {
      collection.meta.initialize();
      collection.doc
        .getMap('meta')
        .set('name', 'Account A private workspace title');
    });
    expect(switched).toBe(true);
    expect(getGoogleDriveWorkspaceOwner(metadata.id)).toBe('account-A');
    expect(
      instance.getEngineWorkerInitOptions(metadata.id).remotes['google-drive']
        .doc?.opts
    ).toMatchObject({ tokens: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a failed disconnect preference write is reported instead of silently resuming sync later', () => {
    cache('cached', 'account-A');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    expect(() => setGoogleDriveWorkspaceSyncPaused('cached', true)).toThrow(
      'preferences could not be saved'
    );
    expect(isGoogleDriveWorkspaceSyncPaused('cached')).toBe(false);
    expect(getGoogleDriveWorkspaceOwner('cached')).toBe('account-A');
  });

  test('explicit disconnect persists per workspace and never deletes Drive files', async () => {
    cache('cached', 'account-A');
    const { instance } = provider('account-A');
    setGoogleDriveWorkspaceSyncPaused('cached', true);
    expect(
      instance.getEngineWorkerInitOptions('cached').remotes['google-drive'].doc
        ?.opts
    ).toMatchObject({ tokens: null });
    expect(getGoogleDriveWorkspaceIds()).toEqual(['cached']);
    expect(getGoogleDriveWorkspaceOwner('cached')).toBe('account-A');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await instance.deleteWorkspace('cached');
    expect(getGoogleDriveWorkspaceIds()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
