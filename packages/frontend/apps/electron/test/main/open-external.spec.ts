import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock('electron', () => ({
  shell: { openExternal: mocks.openExternal },
}));
vi.mock('node:child_process', () => ({
  default: { execFile: mocks.execFile },
}));

import {
  ALLOWED_EXTERNAL_PROTOCOLS,
  isAllowedExternalUrl,
  openExternalSafely,
  openWindowsMicrophoneSettings,
} from '../../src/main/security/open-external';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.openExternal.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Windows microphone Settings opener', () => {
  it('opens only the fixed allowlisted URI without a command shell', async () => {
    await expect(openWindowsMicrophoneSettings()).resolves.toBe(true);
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
      'ms-settings:privacy-microphone'
    );
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('returns false when Electron rejects opening Settings', async () => {
    mocks.openExternal.mockRejectedValue(new Error('Settings unavailable'));
    await expect(openWindowsMicrophoneSettings()).resolves.toBe(false);
  });

  it.each(['darwin', 'linux'] as const)(
    'does not open Windows Settings on %s',
    async platform => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
      await expect(openWindowsMicrophoneSettings()).resolves.toBe(false);
      expect(mocks.openExternal).not.toHaveBeenCalled();
    }
  );
});

describe('general external URL allowlist', () => {
  it.each([
    'ms-settings:privacy-microphone',
    'ms-settings:privacy-camera',
    'MS-SETTINGS:privacy-microphone',
    'ms-settings:privacy-microphone?activation=other',
    'ms-settings:privacy-microphone#other',
    'ms-settings://privacy-microphone',
    'ms-settings:privacy-microphone/../privacy-camera',
    'ms-settings:privacy-microphone%00',
    'ms-settings:privacy-microphone\n',
    'file:///C:/Windows/System32/cmd.exe',
    'javascript:alert(1)',
  ])('does not admit privileged URLs through generic IPC: %s', async url => {
    expect(isAllowedExternalUrl(url)).toBe(false);
    await openExternalSafely(url);
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(ALLOWED_EXTERNAL_PROTOCOLS.has('ms-settings:')).toBe(false);
  });

  it.each([
    'https://example.com/meeting',
    'http://localhost:3010',
    'mailto:person@example.com',
  ])('preserves the existing allowlist for %s', async url => {
    expect(isAllowedExternalUrl(url)).toBe(true);
    await openExternalSafely(url);
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url);
  });
});
