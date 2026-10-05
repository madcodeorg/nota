import { firstValueFrom, take } from 'rxjs';
import { expect, test, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  state: new Map<string, unknown>(),
}));

function mockStorage(values: Map<string, unknown>) {
  return {
    all: vi.fn(() => Object.fromEntries(values)),
    clear: vi.fn(() => values.clear()),
    del: vi.fn((key: string) => values.delete(key)),
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value)),
  };
}

vi.mock('../../src/main/shared-storage/storage', () => ({
  globalCacheStorage: mockStorage(storageMocks.cache),
  globalStateStorage: mockStorage(storageMocks.state),
}));

import {
  globalStateUpdates$,
  publishGlobalStateUpdateFromMain,
} from '../../src/main/shared-storage/broadcast';
import { sharedStorageHandlers } from '../../src/main/shared-storage/handlers';
import { GOOGLE_SESSION_STORAGE_KEY } from '../../src/main/windows-manager/google-calendar-scheduler';

const GOOGLE_SESSION_PUBLIC_STATE_KEY = 'nota-google-session-state:v1';

test('main-process shared-state broadcasts use a revisioned envelope', async () => {
  const update = firstValueFrom(globalStateUpdates$.pipe(take(1)));

  publishGlobalStateUpdateFromMain('test:main-update', { connected: true });

  await expect(update).resolves.toMatchObject({
    'test:main-update': {
      r: expect.any(Number),
      v: { connected: true },
    },
  });
});

test('generic shared-storage IPC cannot mutate legacy Google credentials', async () => {
  const handlers = sharedStorageHandlers as Record<
    string,
    (...args: any[]) => Promise<unknown>
  >;

  await expect(
    handlers.setGlobalState!({}, GOOGLE_SESSION_STORAGE_KEY, {
      tokens: { accessToken: 'secret' },
    })
  ).rejects.toThrow('authenticated Google API');
  await expect(
    handlers.delGlobalState!({}, GOOGLE_SESSION_STORAGE_KEY)
  ).rejects.toThrow('authenticated Google API');
  await expect(
    handlers.setGlobalState!({}, 'nota-google-session-state:v1', {
      connected: false,
    })
  ).rejects.toThrow('authenticated Google API');
});

test('generic shared-state clear preserves Google credential markers', async () => {
  const handlers = sharedStorageHandlers as Record<
    string,
    (...args: any[]) => Promise<unknown>
  >;
  const legacy = { tokens: { accessToken: 'secret' } };
  const publicState = { connected: true, updatedAt: '2026-07-16T00:00:00Z' };
  storageMocks.state.set(GOOGLE_SESSION_STORAGE_KEY, legacy);
  storageMocks.state.set(GOOGLE_SESSION_PUBLIC_STATE_KEY, publicState);
  storageMocks.state.set('ordinary-setting', true);

  await handlers.clearGlobalState!({}, 'renderer-1');

  expect(storageMocks.state.get(GOOGLE_SESSION_STORAGE_KEY)).toBe(legacy);
  expect(storageMocks.state.get(GOOGLE_SESSION_PUBLIC_STATE_KEY)).toBe(
    publicState
  );
  expect(storageMocks.state.has('ordinary-setting')).toBe(false);
});

test('generic shared-storage IPC cannot forge backup destinations', async () => {
  const handlers = sharedStorageHandlers as Record<
    string,
    (...args: any[]) => Promise<unknown>
  >;
  await expect(
    handlers.setGlobalState!({}, 'nota:local-backups:v1:workspace', {
      enabled: true,
      destination: '/arbitrary/destination',
    })
  ).rejects.toThrow('backup settings');
  await expect(
    handlers.delGlobalState!({}, 'nota:local-backups:v1:workspace')
  ).rejects.toThrow('backup settings');
});
