import { describe, expect, it, vi } from 'vitest';

import {
  hasMeetingPermissionIssue,
  isMeetingPermissionBlocking,
  meetingPermissionRecovery,
  meetingPermissionSettingsFailure,
  openRecordingPermissionSettings,
  shouldProbeSystemAudioAfterSettingsOpen,
  shouldProbeSystemAudioOnFocus,
} from '../meeting-permission-refresh';

describe('meetingPermissionRecovery', () => {
  it.each(['unknown', 'not-determined'] as const)(
    'offers a recording attempt instead of requiring Settings for Windows %s',
    status => {
      const recovery = meetingPermissionRecovery(
        'microphone',
        { statuses: { microphone: status, systemAudio: 'unknown' } },
        true
      );
      expect(recovery.requiresSettings).toBe(false);
      expect(recovery.message).toContain('has not been verified');
      expect(recovery.message).toContain('Start a meeting');
      expect(recovery.message).not.toContain('unavailable');
    }
  );

  it.each(['denied', 'restricted'] as const)(
    'still requires Settings for explicit %s access',
    status => {
      const recovery = meetingPermissionRecovery(
        'microphone',
        { statuses: { microphone: status, systemAudio: 'unknown' } },
        true
      );
      expect(recovery.requiresSettings).toBe(true);
      expect(recovery.message).toContain(status);
      expect(recovery.message).toContain('Windows Settings');
      expect(recovery.message).not.toContain('Start a meeting');
    }
  );

  it.each(['unknown', 'not-determined'] as const)(
    'preserves the native probe reason for %s access without a retry instruction',
    status => {
      const reason =
        'This native runtime does not support system-only audio permission checks. Update the native binding before retrying; microphone capture was not started.';
      const recovery = meetingPermissionRecovery(
        'systemAudio',
        {
          reasons: { systemAudio: reason },
          statuses: { microphone: 'granted', systemAudio: status },
        },
        false
      );
      expect(recovery).toEqual({
        message: reason,
        requiresSettings: false,
      });
      expect(recovery.message).not.toContain('Try checking access again');
    }
  );

  it('preserves a supplied Windows microphone reason without inferring denial', () => {
    expect(
      meetingPermissionRecovery(
        'microphone',
        {
          reasons: {
            microphone:
              'Windows microphone access could not be verified. Starting a recording will attempt microphone capture.',
          },
          statuses: { microphone: 'unknown', systemAudio: 'unknown' },
        },
        true
      )
    ).toEqual({
      message:
        'Windows microphone access could not be verified. Starting a recording will attempt microphone capture.',
      requiresSettings: false,
    });
  });

  it('keeps a missing macOS report inconclusive', () => {
    expect(meetingPermissionRecovery('systemAudio', null, false)).toEqual({
      message:
        'System Audio access has not been verified. Try checking access again.',
      requiresSettings: false,
    });
  });
});

describe('meetingPermissionSettingsFailure', () => {
  it.each([
    [true, 'Windows Settings', 'microphone access for desktop apps'],
    [false, 'System Settings', 'Screen & System Audio Recording'],
  ] as const)(
    'provides manual recovery for Windows=%s',
    (windows, app, pane) => {
      const failure = meetingPermissionSettingsFailure(windows);
      expect(failure.title).toBe('Could not open permission settings');
      expect(failure.message).toContain(app);
      expect(failure.message).toContain(pane);
    }
  );
});

describe('isMeetingPermissionBlocking', () => {
  it.each(['unknown', 'not-determined'] as const)(
    'accepts an acquired Windows microphone when preflight is %s',
    status => {
      const report = {
        microphone: false,
        systemAudio: true,
        statuses: { microphone: status, systemAudio: 'unknown' as const },
      };
      expect(
        isMeetingPermissionBlocking('microphone', report, true, true)
      ).toBe(false);
      expect(
        isMeetingPermissionBlocking('microphone', report, true, false)
      ).toBe(true);
      expect(
        isMeetingPermissionBlocking('microphone', report, false, true)
      ).toBe(true);
    }
  );

  it.each(['denied', 'restricted', 'granted'] as const)(
    'does not override a failed microphone check with status %s',
    status => {
      expect(
        isMeetingPermissionBlocking(
          'microphone',
          {
            microphone: false,
            systemAudio: true,
            statuses: { microphone: status, systemAudio: 'unknown' },
          },
          true,
          true
        )
      ).toBe(true);
    }
  );

  it('does not use microphone capture to bypass system-audio checks', () => {
    expect(
      isMeetingPermissionBlocking(
        'systemAudio',
        { microphone: true, systemAudio: false },
        true,
        true
      )
    ).toBe(true);
    expect(
      isMeetingPermissionBlocking(
        'microphone',
        { microphone: true, systemAudio: false },
        false,
        false
      )
    ).toBe(false);
  });
});

describe('hasMeetingPermissionIssue', () => {
  it('does not require a separate system-audio check before recording', () => {
    expect(
      hasMeetingPermissionIssue({
        microphone: true,
        systemAudio: false,
        systemAudioAccessSource: 'not-checked',
      })
    ).toBe(false);
  });

  it('still surfaces microphone, capture and runtime failures', () => {
    expect(
      hasMeetingPermissionIssue({
        microphone: false,
        systemAudio: false,
        systemAudioAccessSource: 'not-checked',
      })
    ).toBe(true);
    expect(
      hasMeetingPermissionIssue({
        microphone: true,
        systemAudio: false,
        systemAudioAccessSource: 'core-audio-probe',
      })
    ).toBe(true);
    expect(
      hasMeetingPermissionIssue({
        microphone: true,
        systemAudio: false,
        systemAudioAccessSource: 'not-checked',
        runtime: { available: false, reason: 'Native binding unavailable' },
      })
    ).toBe(true);
  });

  it('preserves unknown failures and does not warn for ready or loading state', () => {
    expect(
      hasMeetingPermissionIssue({ microphone: true, systemAudio: false })
    ).toBe(true);
    expect(
      hasMeetingPermissionIssue({ microphone: true, systemAudio: true })
    ).toBe(false);
    expect(hasMeetingPermissionIssue(null)).toBe(false);
  });
});

describe('openRecordingPermissionSettings', () => {
  it.each(['false', 'undefined', 'rejected'] as const)(
    'reports a %s launch once and leaves the recovery probe disarmed',
    async outcome => {
      let probeOnNextFocus = true;
      const onFailure = vi.fn();

      await expect(
        openRecordingPermissionSettings(
          'systemAudio',
          async () => {
            if (outcome === 'rejected') {
              throw new Error('Settings launch failed');
            }
            return outcome === 'false' ? false : undefined;
          },
          value => {
            probeOnNextFocus = value;
          },
          onFailure
        )
      ).resolves.toBe(false);
      expect(probeOnNextFocus).toBe(false);
      expect(onFailure).toHaveBeenCalledExactlyOnceWith();
    }
  );

  it.each(['microphone', 'systemAudio'] as const)(
    'does not report a failed launch when %s Settings opens',
    async type => {
      const onFailure = vi.fn();
      const setProbeOnNextFocus = vi.fn();
      await expect(
        openRecordingPermissionSettings(
          type,
          async () => true,
          setProbeOnNextFocus,
          onFailure
        )
      ).resolves.toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(setProbeOnNextFocus).toHaveBeenNthCalledWith(1, false);
      expect(setProbeOnNextFocus).toHaveBeenLastCalledWith(
        type === 'systemAudio'
      );
    }
  );
});

describe('shouldProbeSystemAudioAfterSettingsOpen', () => {
  it('arms the recovery probe only after System Audio Settings opens', () => {
    expect(shouldProbeSystemAudioAfterSettingsOpen('systemAudio', true)).toBe(
      true
    );
    expect(shouldProbeSystemAudioAfterSettingsOpen('systemAudio', false)).toBe(
      false
    );
    expect(
      shouldProbeSystemAudioAfterSettingsOpen('systemAudio', undefined)
    ).toBe(false);
    expect(shouldProbeSystemAudioAfterSettingsOpen('microphone', true)).toBe(
      false
    );
  });
});

describe('shouldProbeSystemAudioOnFocus', () => {
  it('runs a functional probe after System Audio Settings was opened', () => {
    expect(shouldProbeSystemAudioOnFocus(true)).toBe(true);
  });

  it('keeps ordinary focus refreshes passive', () => {
    expect(shouldProbeSystemAudioOnFocus(false)).toBe(false);
  });
});
