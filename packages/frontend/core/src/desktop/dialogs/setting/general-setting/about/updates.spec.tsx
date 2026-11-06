// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updater: {} as Record<string, unknown> }));
vi.mock('@nota/core/components/hooks/use-app-updater', () => ({
  useAppUpdater: () => mocks.updater,
}));
import { UpdateSettings } from './updates';

const check = vi.fn();
const download = vi.fn();
beforeEach(() => {
  mocks.updater = {
    updateAvailable: null,
    updateReady: null,
    downloadProgress: 0,
    checkingForUpdates: false,
    checkForUpdates: check,
    downloadUpdate: download,
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('normal packaged checks cannot be disabled by a legacy UI preference', () => {
  render(<UpdateSettings />);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByText(/startup and every 30 minutes/)).toBeTruthy();
});
test('successful negative checks say up to date', async () => {
  check.mockResolvedValue(false);
  render(<UpdateSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await waitFor(() =>
    expect(screen.getByText('Nota is up to date.')).toBeTruthy()
  );
});
test('a disabled or failed check is not reported as up to date', async () => {
  check.mockResolvedValue(null);
  render(<UpdateSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await waitFor(() =>
    expect(screen.getByText(/Could not check for updates/)).toBeTruthy()
  );
  expect(screen.queryByText('Nota is up to date.')).toBeNull();
});
test('notification-only updates describe manual installation and offer downloads', () => {
  mocks.updater.updateAvailable = {
    version: '0.1.14-beta.2',
    allowAutoUpdate: false,
  };
  render(<UpdateSettings />);
  expect(screen.getByText(/using your package manager/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Open update downloads' })
  );
  expect(download).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole('button', { name: 'Restart to update' })
  ).toBeNull();
});
