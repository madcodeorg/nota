// @vitest-environment happy-dom
import type { MeetingPermissionReport } from '@nota/core/modules/media/services/meeting-settings';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  ask: vi.fn(),
  calendar: vi.fn(),
}));

vi.mock('@nota/core/modules/desktop-api', () => ({
  DesktopApiService: class DesktopApiService {},
}));
vi.mock('@nota/infra', () => ({
  useServiceOptional: () => ({
    handler: {
      recording: {
        checkMeetingPermissions: mocks.check,
        askForMeetingPermission: mocks.ask,
      },
      calendar: { getLocalCalendarStatus: mocks.calendar },
    },
  }),
}));

import { NotaPermissionsSetup } from './permissions-setup';

function windowsReport(): MeetingPermissionReport {
  return {
    checkedAt: 1,
    microphone: true,
    ready: true,
    runtime: { available: true, reason: null },
    systemAudio: true,
    systemAudioAccessSource: 'platform-compatibility',
    reasons: {
      systemAudio:
        'Windows system audio access is verified when recording starts.',
    },
    statuses: { microphone: 'granted', systemAudio: 'unknown' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('environment', { isWindows: true, isMacOs: false });
  mocks.check.mockResolvedValue(windowsReport());
  mocks.calendar.mockResolvedValue({
    available: false,
    authorized: false,
    status: 'unsupported',
    supported: false,
    reason: 'Calendar is unavailable.',
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('explains deferred Windows system audio verification without claiming permission or blocking setup', async () => {
  const onContinue = vi.fn();
  render(<NotaPermissionsSetup onContinue={onContinue} onSkip={vi.fn()} />);
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.ask).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
  await waitFor(() =>
    expect(screen.getByText('Checked on start')).toBeTruthy()
  );
  expect(screen.queryByText('unknown')).toBeNull();
  expect(
    screen.getByText(
      'Microphone access is ready. System audio is checked when recording starts.'
    )
  ).toBeTruthy();
  expect(mocks.ask).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Allow system audio' })
  ).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(onContinue).toHaveBeenCalledOnce();
});

test('shows an unavailable capture runtime rather than a deferred Windows check', async () => {
  const report = windowsReport();
  report.ready = false;
  report.runtime = {
    available: false,
    reason: 'Native recording binding is unavailable.',
  };
  mocks.check.mockResolvedValue(report);
  render(<NotaPermissionsSetup onContinue={vi.fn()} onSkip={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
  await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
  expect(
    screen.getByText('Native recording binding is unavailable.')
  ).toBeTruthy();
  expect(screen.queryByText('Checked on start')).toBeNull();
});

test('preserves an unverified macOS result instead of implying it will pass at recording startup', async () => {
  vi.stubGlobal('environment', { isWindows: false, isMacOs: true });
  const report = windowsReport();
  report.ready = false;
  report.systemAudio = false;
  report.systemAudioAccessSource = 'core-audio-probe';
  report.reasons = { systemAudio: 'System audio check failed.' };
  mocks.check.mockResolvedValue(report);
  render(<NotaPermissionsSetup onContinue={vi.fn()} onSkip={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
  await waitFor(() => expect(screen.getByText('unknown')).toBeTruthy());
  expect(screen.getByText('System audio check failed.')).toBeTruthy();
  expect(screen.queryByText('Checked on start')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Allow system audio' })
  ).toBeTruthy();
});
