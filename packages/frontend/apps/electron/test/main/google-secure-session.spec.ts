import fs from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteState: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/nota-secure-session-test') },
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    getSelectedStorageBackend: vi.fn(() => 'keychain'),
    isEncryptionAvailable: vi.fn(() => true),
  },
}));

vi.mock('../../src/main/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/main/shared-storage/broadcast', () => ({
  publishGlobalStateUpdateFromMain: mocks.publish,
}));

vi.mock('../../src/main/shared-storage/storage', () => ({
  globalStateStorage: {
    del: mocks.deleteState,
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { clearSecureGoogleSession } from '../../src/main/google-auth/secure-session';

afterEach(() => {
  vi.restoreAllMocks();
  mocks.deleteState.mockReset();
  mocks.publish.mockReset();
});

describe('secure Google session deletion', () => {
  test('does not publish logout or clear legacy state when file removal fails', () => {
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('disk denied deletion');
    });

    expect(() => clearSecureGoogleSession()).toThrow(
      'Failed to remove the secure Google session'
    );
    expect(mocks.deleteState).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
