import type { MeetingPermissionReport } from './services/meeting-settings';

export function meetingPermissionRecovery(
  type: 'microphone' | 'systemAudio',
  report:
    | Partial<Pick<MeetingPermissionReport, 'reasons' | 'statuses'>>
    | null
    | undefined,
  isWindows: boolean
) {
  const status = report?.statuses?.[type];
  const requiresSettings = status === 'denied' || status === 'restricted';
  const label = type === 'microphone' ? 'Microphone' : 'System Audio';
  const message =
    report?.reasons?.[type] ||
    (requiresSettings
      ? `${label} access is ${status}. Check ${isWindows ? 'Windows' : 'macOS'} Settings to allow access, then return.`
      : isWindows && type === 'microphone'
        ? 'Microphone access has not been verified. Start a meeting to attempt microphone capture, or open Windows Settings to check access.'
        : `${label} access has not been verified. Try checking access again.`);
  return { message, requiresSettings };
}

export function meetingPermissionSettingsFailure(isWindows: boolean) {
  return {
    title: 'Could not open permission settings',
    message: isWindows
      ? 'Open Windows Settings > Privacy & security > Microphone and allow microphone access for desktop apps.'
      : 'Open System Settings > Privacy & Security and check Microphone or Screen & System Audio Recording access for this app.',
  };
}

export function isMeetingPermissionBlocking(
  type: 'microphone' | 'systemAudio',
  report: Pick<MeetingPermissionReport, 'microphone' | 'systemAudio'> &
    Partial<Pick<MeetingPermissionReport, 'statuses'>>,
  isWindows: boolean,
  microphoneAcquired: boolean
) {
  if (report[type]) return false;
  // A live getUserMedia stream is stronger evidence than an inconclusive
  // Windows preflight. Never override an explicit OS denial or restriction.
  return !(
    isWindows &&
    type === 'microphone' &&
    microphoneAcquired &&
    (report.statuses?.microphone === 'unknown' ||
      report.statuses?.microphone === 'not-determined')
  );
}

export function shouldProbeSystemAudioAfterSettingsOpen(
  type: 'microphone' | 'systemAudio',
  settingsOpened: boolean | undefined
) {
  return type === 'systemAudio' && settingsOpened === true;
}

export async function openRecordingPermissionSettings(
  type: 'microphone' | 'systemAudio',
  openSettings: () => Promise<boolean | undefined>,
  setProbeOnNextFocus: (value: boolean) => void,
  onFailure: () => void
) {
  // Clear a previously armed request before launching. If the launch rejects,
  // no later unrelated focus is allowed to start a Core Audio probe.
  setProbeOnNextFocus(false);
  const opened = await openSettings().catch(() => false);
  setProbeOnNextFocus(shouldProbeSystemAudioAfterSettingsOpen(type, opened));
  if (opened !== true) {
    onFailure();
    return false;
  }
  return true;
}

/**
 * Only an explicit System Settings visit arms a functional probe on return.
 * Ordinary focus changes reuse cached access; recording startup rechecks it.
 */
export function shouldProbeSystemAudioOnFocus(
  probeAfterOpeningSettings: boolean
) {
  return probeAfterOpeningSettings;
}

export function hasMeetingPermissionIssue(
  report:
    | (Pick<MeetingPermissionReport, 'microphone' | 'systemAudio'> &
        Partial<
          Pick<MeetingPermissionReport, 'runtime' | 'systemAudioAccessSource'>
        >)
    | null
) {
  if (!report) return false;
  return (
    report.runtime?.available === false ||
    !report.microphone ||
    (!report.systemAudio && report.systemAudioAccessSource !== 'not-checked')
  );
}
