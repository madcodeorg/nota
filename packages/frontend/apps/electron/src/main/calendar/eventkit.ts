import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { isMacOS } from '../../shared/utils';
import { openMacSystemSettings } from '../security/open-external';
import {
  getMacOSPermissionClient,
  type MacOSPermissionClient,
} from '../security/permission-client';
import type { NamespaceHandlers } from '../type';

const nativeBinaryBaseName = 'nota-calendar-native';
const nativeRequestTimeoutMs = 1000 * 120;
const nativeRequire = createRequire(__filename);

type EventKitAuthorizationStatus =
  | 'authorized'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unsupported'
  | 'unknown'
  | 'write-only';

type EventKitStatus = {
  available: boolean;
  authorized: boolean;
  calendarsCount?: number;
  eventsCount?: number;
  platform?: string;
  permissionClient: MacOSPermissionClient;
  reason?: string | null;
  // A bounded caller wait does not cancel an outstanding macOS request.
  requestPending?: boolean;
  status: EventKitAuthorizationStatus;
  supported: boolean;
};

type EventKitCalendar = {
  allowsContentModifications?: boolean;
  color?: string | null;
  id: string;
  title: string;
};

type EventKitParticipant = {
  email?: string | null;
  name?: string | null;
  role?: string | null;
  status?: string | null;
  type?: string | null;
  url?: string | null;
};

type EventKitEvent = {
  allDay: boolean;
  attendees?: EventKitParticipant[];
  availability?: string | null;
  calendarColor?: string | null;
  calendarId: string;
  calendarName?: string | null;
  endAt: string;
  externalEventId?: string;
  id: string;
  location?: string | null;
  meetingUrl?: string | null;
  notes?: string | null;
  organizer?: EventKitParticipant;
  startAt: string;
  status?: string | null;
  title: string;
  url?: string | null;
};

type NativeCalendarOutput = Omit<
  EventKitStatus,
  'permissionClient' | 'requestPending'
> & {
  requestPending: boolean;
};

type NativeCalendarBinding = {
  getAppleCalendarStatus?: () => NativeCalendarOutput;
  requestAppleCalendarAccess?: (
    callback: (error: Error | null, status?: NativeCalendarOutput) => void
  ) => void;
  listAppleCalendars?: () => EventKitCalendar[];
  listAppleCalendarEvents?: (input: {
    calendarIds?: string[];
    from: string;
    to: string;
  }) => EventKitEvent[];
};

let nativeBindingCache: NativeCalendarBinding | undefined;
let nativeBindingLoadError: unknown;
let pendingAccessRequest: {
  promise: Promise<EventKitStatus>;
  resolve: (status: EventKitStatus) => void;
  timeout: ReturnType<typeof setTimeout>;
  timedOut: boolean;
} | null = null;

function unsupportedStatus(reason: string): EventKitStatus {
  return {
    available: false,
    authorized: false,
    platform: process.platform,
    permissionClient: getMacOSPermissionClient(),
    reason,
    status: 'unsupported',
    supported: false,
  };
}

function nativeBinarySuffix() {
  if (process.arch === 'arm64') {
    return 'darwin-arm64';
  }
  if (process.arch === 'x64') {
    return 'darwin-x64';
  }
  return null;
}

function nativeBinaryNames() {
  const suffix = nativeBinarySuffix();
  return [
    suffix ? `${nativeBinaryBaseName}.${suffix}.node` : undefined,
    `${nativeBinaryBaseName}.darwin-universal.node`,
  ].filter((name): name is string => !!name);
}

function nativeCalendarBindingCandidates() {
  const directories = [
    process.resourcesPath
      ? path.resolve(process.resourcesPath, 'native')
      : undefined,
    path.resolve(process.cwd(), 'resources/native'),
    path.resolve(
      process.cwd(),
      'packages/frontend/apps/electron/resources/native'
    ),
    path.resolve(__dirname, '../resources/native'),
    path.resolve(__dirname, '../../../resources/native'),
    process.resourcesPath
      ? path.resolve(process.resourcesPath, 'app.asar.unpacked', 'native')
      : undefined,
  ].filter((candidate): candidate is string => !!candidate);

  return [
    process.env.NOTA_APPLE_CALENDAR_NATIVE,
    ...directories.flatMap(directory =>
      nativeBinaryNames().map(name => path.join(directory, name))
    ),
  ].filter((candidate): candidate is string => !!candidate);
}

function loadNativeCalendarBinding() {
  if (nativeBindingCache !== undefined) {
    return nativeBindingCache;
  }

  nativeBindingLoadError = undefined;
  if (!isMacOS()) {
    return null;
  }

  for (const candidate of nativeCalendarBindingCandidates()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const binding = nativeRequire(candidate) as NativeCalendarBinding;
      if (typeof binding.getAppleCalendarStatus === 'function') {
        nativeBindingCache = binding;
        return nativeBindingCache;
      }
    } catch (error) {
      nativeBindingLoadError = error;
    }
  }

  // A missing or temporarily unloadable addon must be retryable in this process.
  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeStatus(output: NativeCalendarOutput): EventKitStatus {
  if (typeof output?.requestPending !== 'boolean') {
    throw new Error(
      'Apple Calendar native binding is outdated or incompatible. Rebuild the calendar native binding and restart Nota.'
    );
  }
  return {
    available: output.available ?? true,
    authorized: output.authorized ?? output.status === 'authorized',
    calendarsCount: output.calendarsCount,
    eventsCount: output.eventsCount,
    platform: output.platform ?? 'darwin',
    permissionClient: getMacOSPermissionClient(),
    reason: output.reason ?? null,
    requestPending: output.requestPending,
    status: output.status ?? 'unknown',
    supported: output.supported ?? true,
  };
}

function nativeCalendarStatus() {
  const binding = loadNativeCalendarBinding();
  if (!binding?.getAppleCalendarStatus) {
    return null;
  }

  const status = normalizeStatus(
    binding.getAppleCalendarStatus() as NativeCalendarOutput
  );
  const pending = pendingAccessRequest;
  if (pending && (status.authorized || !status.requestPending)) {
    clearTimeout(pending.timeout);
    pending.resolve(status);
    // Authorization recovery does not cancel an outstanding OS completion.
    if (!status.requestPending) {
      pendingAccessRequest = null;
    } else {
      pending.timedOut = true;
    }
  }
  if (status.requestPending && !status.authorized) {
    status.reason ??=
      'Apple Calendar access is still waiting for macOS. Respond to the permission dialog or check System Settings.';
  }
  return status;
}

function requestNativeCalendarAccess() {
  if (pendingAccessRequest && !pendingAccessRequest.timedOut) {
    return pendingAccessRequest.promise;
  }

  const binding = loadNativeCalendarBinding();
  if (!binding?.requestAppleCalendarAccess) {
    return null;
  }

  const status = nativeCalendarStatus();
  if (!status) {
    return null;
  }
  if (
    pendingAccessRequest ||
    !status.available ||
    !status.supported ||
    status.authorized ||
    status.requestPending ||
    (status.status !== 'not-determined' && status.status !== 'write-only')
  ) {
    return Promise.resolve(status);
  }

  let resolve!: (status: EventKitStatus) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<EventKitStatus>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const pending = {
    promise,
    resolve,
    timedOut: false,
    timeout: setTimeout(() => {
      if (pendingAccessRequest !== pending) {
        return;
      }
      pending.timedOut = true;
      // Bound the caller's wait, not the OS prompt's lifetime. Keep the callback
      // and single-flight owner until completion or a confirmed idle status.
      safeStatus().then(resolve).catch(reject);
    }, nativeRequestTimeoutMs),
  };
  pendingAccessRequest = pending;

  const finish = (error: Error | null, output?: NativeCalendarOutput) => {
    if (pendingAccessRequest !== pending) {
      return;
    }
    pendingAccessRequest = null;
    clearTimeout(pending.timeout);
    if (error) {
      reject(error);
    } else if (!output) {
      reject(new Error('Apple Calendar native request returned no status.'));
    } else {
      try {
        resolve(normalizeStatus(output));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  try {
    binding.requestAppleCalendarAccess(finish);
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
  return promise;
}

async function safeStatus(): Promise<EventKitStatus> {
  if (!isMacOS()) {
    return unsupportedStatus(
      'Local Apple Calendar is only available on macOS.'
    );
  }

  try {
    const status = nativeCalendarStatus();
    if (status) {
      return status;
    }
    throw (
      nativeBindingLoadError ?? new Error('Native calendar binding missing.')
    );
  } catch (error) {
    return {
      available: false,
      authorized: false,
      platform: process.platform,
      permissionClient: getMacOSPermissionClient(),
      reason: errorMessage(error),
      requestPending: !!pendingAccessRequest,
      status: 'unknown',
      supported: true,
    };
  }
}

export const calendarHandlers = {
  getLocalCalendarStatus: async () => {
    return safeStatus();
  },
  requestLocalCalendarAccess: async () => {
    if (!isMacOS()) {
      return unsupportedStatus(
        'Local Apple Calendar is only available on macOS.'
      );
    }

    try {
      const nativeRequest = requestNativeCalendarAccess();
      if (!nativeRequest) {
        throw (
          nativeBindingLoadError ??
          new Error('Apple Calendar native binding is unavailable.')
        );
      }
      return await nativeRequest;
    } catch (error) {
      return {
        available: false,
        authorized: false,
        platform: process.platform,
        permissionClient: getMacOSPermissionClient(),
        reason: errorMessage(error),
        requestPending: !!pendingAccessRequest,
        status: 'unknown',
        supported: true,
      } satisfies EventKitStatus;
    }
  },
  listLocalCalendars: async () => {
    if (!isMacOS()) {
      return [] satisfies EventKitCalendar[];
    }

    const binding = loadNativeCalendarBinding();
    if (binding?.listAppleCalendars) {
      return binding.listAppleCalendars();
    }
    throw (
      nativeBindingLoadError ?? new Error('Native calendar binding missing.')
    );
  },
  listLocalCalendarEvents: async (
    _,
    input?: {
      calendarIds?: string[];
      from?: string;
      to?: string;
    }
  ) => {
    if (!isMacOS()) {
      return [] satisfies EventKitEvent[];
    }

    const from = input?.from;
    const to = input?.to;
    if (!from || !to) {
      throw new Error('from and to are required.');
    }

    const calendarIds = (input.calendarIds ?? []).filter(Boolean);
    const binding = loadNativeCalendarBinding();
    if (binding?.listAppleCalendarEvents) {
      return binding.listAppleCalendarEvents({
        calendarIds,
        from,
        to,
      });
    }
    throw (
      nativeBindingLoadError ?? new Error('Native calendar binding missing.')
    );
  },
  showLocalCalendarPermissionSetting: async () => {
    if (!isMacOS()) {
      return false;
    }

    return openMacSystemSettings('Privacy_Calendars');
  },
} satisfies NamespaceHandlers;
