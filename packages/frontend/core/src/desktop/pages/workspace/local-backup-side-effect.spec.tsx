// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  runBackup: vi.fn(),
  waitForUpdated: vi.fn(),
  flavour: 'local',
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
}));
vi.mock('@nota/core/modules/desktop-api', () => ({
  DesktopApiService: class DesktopApiService {},
}));
vi.mock('@nota/nbstore', () => ({ universalId: () => 'workspace-id' }));
vi.mock('@nota/infra', () => ({
  useService: (token: { name: string }) =>
    token.name === 'WorkspaceService'
      ? {
          workspace: {
            id: 'workspace',
            flavour: mocks.flavour,
            rootYDoc: { guid: 'root' },
            engine: { doc: { waitForUpdated: mocks.waitForUpdated } },
          },
        }
      : {
          handler: {
            workspace: {
              getLocalBackupSettings: mocks.getSettings,
              runLocalBackup: mocks.runBackup,
            },
          },
        },
}));

import { LocalBackupSideEffect } from './local-backup-side-effect';

describe('automatic backup lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('BUILD_CONFIG', { isElectron: true });
    mocks.flavour = 'local';
    mocks.getSettings.mockResolvedValue({ enabled: true });
    mocks.waitForUpdated.mockResolvedValue(undefined);
    mocks.runBackup.mockResolvedValue({
      enabled: true,
      lastSuccess: Date.now(),
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for root metadata and local document writes before requesting a backup', async () => {
    render(<LocalBackupSideEffect />);
    await waitFor(() => expect(mocks.runBackup).toHaveBeenCalledOnce());
    expect(mocks.waitForUpdated.mock.calls.map(args => args[0])).toEqual([
      'root',
      undefined,
    ]);
    expect(mocks.waitForUpdated.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.runBackup.mock.invocationCallOrder[0]
    );
  });

  it('stops its timer and cancels pending persistence waits on unmount', async () => {
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const setInterval = vi.spyOn(window, 'setInterval');
    let finish: (() => void) | undefined;
    mocks.waitForUpdated.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const view = render(<LocalBackupSideEffect />);
    await waitFor(() => expect(mocks.waitForUpdated).toHaveBeenCalledOnce());
    const signal = mocks.waitForUpdated.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    const intervalIndex = setInterval.mock.calls.findIndex(
      call => call[1] === 10 * 60 * 1000
    );
    expect(clearInterval).toHaveBeenCalledWith(
      setInterval.mock.results[intervalIndex].value
    );
    await act(async () => {
      finish?.();
    });
    window.dispatchEvent(new Event('focus'));
    expect(mocks.getSettings).toHaveBeenCalledOnce();
    expect(mocks.runBackup).not.toHaveBeenCalled();
  });

  it('skips disabled or recently completed backups without touching local writers', async () => {
    mocks.getSettings.mockResolvedValue({ enabled: false });
    const disabled = render(<LocalBackupSideEffect />);
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalledOnce());
    expect(mocks.waitForUpdated).not.toHaveBeenCalled();
    disabled.unmount();
    mocks.getSettings.mockResolvedValue({
      enabled: true,
      lastSuccess: Date.now(),
    });
    render(<LocalBackupSideEffect />);
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(2));
    expect(mocks.runBackup).not.toHaveBeenCalled();
  });

  it('does not schedule backups for Drive workspaces', () => {
    mocks.flavour = 'google-drive';
    render(<LocalBackupSideEffect />);
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.runBackup).not.toHaveBeenCalled();
  });
});
