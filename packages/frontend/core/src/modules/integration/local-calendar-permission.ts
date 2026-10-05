import type { LocalCalendarStatus } from './type';

export type LocalCalendarPermissionAction =
  | 'connect'
  | 'open-settings'
  | 'request-full-access'
  | 'retry';

export type LocalCalendarPermissionPresentation = {
  action: LocalCalendarPermissionAction | null;
  actionLabel: string | null;
  connected: boolean;
  description: string;
  title: string;
};

function permissionCopyContext(status: LocalCalendarStatus) {
  const client = status.permissionClient;
  if (!client) {
    return {
      separateInstalledApp: '',
      settingsName: 'this app',
      subject: 'this app',
    };
  }

  if (client.kind === 'development-host') {
    return {
      separateInstalledApp:
        ' Installed Nota has a separate macOS permission and was not checked.',
      settingsName: client.displayName,
      subject: `${client.displayName} (local development)`,
    };
  }

  return {
    separateInstalledApp: '',
    settingsName: client.displayName,
    subject: `${client.displayName} (this running build)`,
  };
}

/**
 * Converts the native EventKit status into one consistent, user-facing state.
 * Keep this mapping independent from React so every Calendar surface explains
 * the same macOS permission state and performs the same next action.
 */
export function presentLocalCalendarPermission(
  status: LocalCalendarStatus | null
): LocalCalendarPermissionPresentation {
  if (!status) {
    return {
      action: null,
      actionLabel: null,
      connected: false,
      description: 'Checking Apple Calendar access…',
      title: 'Checking Apple Calendar access',
    };
  }

  if (!status.supported || status.status === 'unsupported') {
    return {
      action: null,
      actionLabel: null,
      connected: false,
      description: 'Apple Calendar integration is unavailable on this device.',
      title: 'Apple Calendar unavailable',
    };
  }

  if (
    status.requestPending &&
    !(status.available && (status.authorized || status.status === 'authorized'))
  ) {
    const { separateInstalledApp, subject } = permissionCopyContext(status);
    return {
      action: 'retry',
      actionLabel: 'Check status',
      connected: false,
      description: `Apple Calendar access for ${subject} is still waiting for macOS. Respond to the permission dialog or check System Settings.${separateInstalledApp}`,
      title: 'Waiting for Apple Calendar',
    };
  }

  if (!status.available) {
    return unverifiableCalendarPermission(status);
  }

  const { separateInstalledApp, settingsName, subject } =
    permissionCopyContext(status);

  if (status.authorized || status.status === 'authorized') {
    return {
      action: null,
      actionLabel: null,
      connected: true,
      description: `Apple Calendar has Full Access for ${subject}. Upcoming meetings appear before you record.${separateInstalledApp}`,
      title: 'Apple Calendar connected',
    };
  }

  switch (status.status) {
    case 'not-determined':
      return {
        action: 'connect',
        actionLabel: 'Connect',
        connected: false,
        description: `${subject} has not requested Apple Calendar access. Connect it to see upcoming meetings before you record.${separateInstalledApp}`,
        title: 'Connect Apple Calendar',
      };
    case 'write-only':
      return {
        action: 'request-full-access',
        actionLabel: 'Request Full Access',
        connected: false,
        description: `macOS gives ${subject} Add Only access. Choose Full Access for ${settingsName} so it can read and show upcoming meetings.${separateInstalledApp}`,
        title: 'Apple Calendar needs Full Access',
      };
    case 'denied':
      return {
        action: 'open-settings',
        actionLabel: 'Open Settings',
        connected: false,
        description: `Apple Calendar access is off for ${subject}. Turn it on for ${settingsName} in macOS Settings.${separateInstalledApp}`,
        title: 'Apple Calendar access is off',
      };
    case 'restricted':
      return {
        action: 'open-settings',
        actionLabel: 'Open Settings',
        connected: false,
        description: `A device or organization policy is restricting Apple Calendar access for ${subject}. Check macOS Settings or contact your administrator.${separateInstalledApp}`,
        title: 'Apple Calendar access is restricted',
      };
    case 'unknown':
      return unverifiableCalendarPermission(status);
  }
}

function unverifiableCalendarPermission(
  status: LocalCalendarStatus
): LocalCalendarPermissionPresentation {
  const { separateInstalledApp, subject } = permissionCopyContext(status);
  const detail =
    status.status === 'unknown' && status.reason?.trim()
      ? status.reason.trim()
      : 'Try again.';
  return {
    action: 'retry',
    actionLabel: 'Retry',
    connected: false,
    description: `Could not verify Apple Calendar access for ${subject}. ${detail}${separateInstalledApp}`,
    title: 'Could not verify Apple Calendar',
  };
}
