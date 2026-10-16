// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updater: {} as Record<string, unknown>,
}));
vi.mock('@nota/core/components/hooks/use-app-updater', () => ({
  useAppUpdater: () => mocks.updater,
}));

import { HeaderUpdateButton } from './header-update-button';

const original = BUILD_CONFIG.isElectron;
const downloadUpdate = vi.fn();
const quitAndInstall = vi.fn();
const button = () => screen.queryByTestId('header-update-button');

beforeEach(() => {
  BUILD_CONFIG.isElectron = true;
  mocks.updater = {
    updateAvailable: null,
    updateReady: null,
    downloadProgress: 0,
    appQuitting: false,
    downloadUpdate,
    quitAndInstall,
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  BUILD_CONFIG.isElectron = original;
});

describe('HeaderUpdateButton', () => {
  test('stays hidden until an update is found', () => {
    render(<HeaderUpdateButton />);
    expect(button()).toBeNull();
  });

  test('downloads the update that was found', () => {
    mocks.updater.updateAvailable = { version: '1.2.0', allowAutoUpdate: true };
    render(<HeaderUpdateButton />);
    expect(button()?.textContent).toBe('Update to 1.2.0');
    fireEvent.click(button()!);
    expect(downloadUpdate).toHaveBeenCalledOnce();
  });

  test('shows download progress', () => {
    mocks.updater.updateAvailable = { version: '1.2.0', allowAutoUpdate: true };
    mocks.updater.downloadProgress = 41.6;
    render(<HeaderUpdateButton />);
    expect(button()?.textContent).toBe('Downloading 42%');
    expect((button() as HTMLButtonElement).disabled).toBe(true);
  });

  test('restarts to install a downloaded update', () => {
    mocks.updater.updateAvailable = { version: '1.2.0', allowAutoUpdate: true };
    mocks.updater.updateReady = { version: '1.2.0', allowAutoUpdate: true };
    mocks.updater.downloadProgress = 100;
    render(<HeaderUpdateButton />);
    expect(button()?.textContent).toBe('Restart to update');
    fireEvent.click(button()!);
    expect(quitAndInstall).toHaveBeenCalledOnce();
  });

  test('is not shown outside the desktop app', () => {
    BUILD_CONFIG.isElectron = false;
    mocks.updater.updateAvailable = { version: '1.2.0', allowAutoUpdate: true };
    render(<HeaderUpdateButton />);
    expect(button()).toBeNull();
  });
});
