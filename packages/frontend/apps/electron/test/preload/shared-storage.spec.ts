import { beforeEach, expect, test, vi } from 'vitest';

import {
  NOTA_EVENT_CHANNEL_NAME,
  NOTA_EVENT_SUBSCRIBE_CHANNEL_NAME,
} from '../../src/shared/type';

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: electronMocks,
}));

beforeEach(() => {
  electronMocks.invoke.mockClear();
  electronMocks.on.mockClear();
  electronMocks.send.mockClear();
});

test('subscribes shared storage to main-process state broadcasts', async () => {
  await import('../../src/preload/shared-storage');

  expect(electronMocks.on).toHaveBeenCalledWith(
    NOTA_EVENT_CHANNEL_NAME,
    expect.any(Function)
  );
  expect(electronMocks.send).toHaveBeenCalledWith(
    NOTA_EVENT_SUBSCRIBE_CHANNEL_NAME,
    'subscribe',
    'sharedStorage:onGlobalStateChanged'
  );
  expect(electronMocks.send).toHaveBeenCalledWith(
    NOTA_EVENT_SUBSCRIBE_CHANNEL_NAME,
    'subscribe',
    'sharedStorage:onGlobalCacheChanged'
  );
});
