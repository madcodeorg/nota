import Module, { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  askForMediaAccess: vi.fn(),
  getMediaAccessStatus: vi.fn(),
  loadNative: vi.fn(),
  nativeDependencies: vi.fn(),
  openMacSystemSettings: vi.fn(),
  openWindowsMicrophoneSettings: vi.fn(),
  nativeProbe: vi.fn(),
  probe: vi.fn(),
  peek: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: () => Buffer.from('15.0.0'),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nota-meeting-permission-tests' },
  shell: {},
  systemPreferences: {
    askForMediaAccess: mocks.askForMediaAccess,
    getMediaAccessStatus: mocks.getMediaAccessStatus,
  },
}));
vi.mock('../../src/main/cleanup', () => ({
  beforeAppQuit: vi.fn(),
}));
vi.mock('../../src/main/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../src/main/security/permission-client', () => ({
  getMacOSPermissionClient: () => ({
    bundleIdentifier: null,
    displayName: 'Nota',
    kind: 'packaged-build',
  }),
}));
vi.mock('../../src/main/security/open-external', () => ({
  openMacSystemSettings: mocks.openMacSystemSettings,
  openWindowsMicrophoneSettings: mocks.openWindowsMicrophoneSettings,
}));
vi.mock('../../src/main/shared-storage/storage', async () => {
  const { of } = await import('rxjs');
  return { globalStateStorage: { watch: () => of({}), get: () => ({}) } };
});
vi.mock('../../src/main/windows-manager', () => ({
  getMainWindow: vi.fn(),
}));
vi.mock('../../src/main/windows-manager/popup', () => ({
  popupManager: {},
}));
vi.mock('../../src/main/recording/apple-speech-bridge', () => ({}));
vi.mock('../../src/main/recording/audio-forward', () => ({}));
vi.mock('../../src/main/recording/native-runtime', () => ({
  ensureNativeRecordingRuntimeDependencies: mocks.nativeDependencies,
}));
vi.mock('../../src/main/recording/system-audio-access', () => ({
  SystemAudioAccessProbe: class {
    check = mocks.probe;
    peek = mocks.peek;
  },
}));

import {
  askForMeetingPermission,
  checkMeetingPermissions,
  getRecordingRuntimeStatus,
  type MeetingMediaAccessStatus,
  type MeetingPermissionReport,
} from '../../src/main/recording/feature';
import { recordingHandlers } from '../../src/main/recording/index';

const require = createRequire(import.meta.url);
const nativeModuleId = require.resolve('@nota/native');
const previousNativeModule = require.cache[nativeModuleId];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  // Vitest's ESM mocks do not intercept the native binding's CommonJS require.
  const nativeModule = new Module(nativeModuleId);
  Object.defineProperty(nativeModule.exports, 'ShareableContent', {
    get: () => mocks.loadNative().ShareableContent,
  });
  require.cache[nativeModuleId] = nativeModule;
  mocks.loadNative.mockReturnValue({ ShareableContent: {} });
  mocks.nativeDependencies.mockReturnValue({ missing: [] });
  mocks.getMediaAccessStatus.mockReturnValue('granted');
  mocks.peek.mockReturnValue(null);
  mocks.openWindowsMicrophoneSettings.mockResolvedValue(true);
  mocks.openMacSystemSettings.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousNativeModule) {
    require.cache[nativeModuleId] = previousNativeModule;
  } else {
    delete require.cache[nativeModuleId];
  }
});

describe('Windows meeting permission report', () => {
  it.each<MeetingMediaAccessStatus>([
    'granted',
    'denied',
    'restricted',
    'not-determined',
    'unknown',
  ])('reports the actual %s microphone status without prompting', status => {
    mocks.getMediaAccessStatus.mockReturnValue(status);

    const report: MeetingPermissionReport | undefined =
      checkMeetingPermissions();

    expect(report).toMatchObject({
      microphone: status === 'granted',
      ready: status === 'granted',
      runtime: { available: true },
      systemAudio: true,
      systemAudioAccessSource: 'platform-compatibility',
      statuses: { microphone: status, systemAudio: 'unknown' },
    });
    expect(mocks.getMediaAccessStatus).toHaveBeenCalledExactlyOnceWith(
      'microphone'
    );
    expect(mocks.loadNative).toHaveBeenCalledOnce();
    expect(mocks.askForMediaAccess).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.peek).not.toHaveBeenCalled();
    if (status === 'granted') {
      expect(report?.reasons.microphone).toBeUndefined();
    } else {
      expect(report?.reasons.microphone).toBeTruthy();
    }
  });

  it('does not infer WASAPI permission from the Windows screen status', () => {
    const report = checkMeetingPermissions({
      forceSystemAudioProbe: true,
      probeSystemAudio: true,
    });
    expect(report?.statuses.systemAudio).toBe('unknown');
    expect(mocks.getMediaAccessStatus).toHaveBeenCalledExactlyOnceWith(
      'microphone'
    );
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('never reports ready when the native runtime is unavailable', () => {
    mocks.loadNative.mockImplementation(() => {
      throw new Error('native binding unavailable');
    });

    expect(checkMeetingPermissions()).toMatchObject({
      microphone: true,
      ready: false,
      runtime: {
        available: false,
        reason: expect.stringContaining('native binding unavailable'),
      },
      statuses: { microphone: 'granted', systemAudio: 'unknown' },
    });
  });

  it('reports a failed status read as unknown, not granted', () => {
    mocks.getMediaAccessStatus.mockImplementation(() => {
      throw new Error('status unavailable');
    });
    expect(checkMeetingPermissions()).toMatchObject({
      microphone: false,
      ready: false,
      reasons: { microphone: expect.stringContaining('could not be verified') },
      statuses: { microphone: 'unknown' },
    });
  });

  it('rereads access after Settings without caching a denial', () => {
    mocks.getMediaAccessStatus
      .mockReturnValueOnce('denied')
      .mockReturnValueOnce('granted');
    expect(checkMeetingPermissions()?.microphone).toBe(false);
    expect(checkMeetingPermissions()?.microphone).toBe(true);
    expect(mocks.getMediaAccessStatus).toHaveBeenCalledTimes(2);
  });

  it.each(['microphone', 'systemAudio', 'screen'] as const)(
    'never calls macOS askForMediaAccess for Windows %s',
    async type => {
      await expect(askForMeetingPermission(type)).resolves.toBe(false);
      expect(mocks.askForMediaAccess).not.toHaveBeenCalled();
      expect(mocks.probe).not.toHaveBeenCalled();
    }
  );
});

describe('other platforms', () => {
  it.each([undefined, null, true])(
    'reports a missing macOS probe capability (%s) before capture or prompting',
    probeSystemAudioAccess => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      mocks.loadNative.mockReturnValue({
        ShareableContent: { probeSystemAudioAccess },
      });
      const runtime = getRecordingRuntimeStatus();
      expect(runtime).toEqual({
        available: false,
        reason: expect.stringContaining('Rebuild the complete @nota/native'),
      });
      expect(runtime.reason).toContain('missing probeSystemAudioAccess');
      expect(checkMeetingPermissions()).toMatchObject({
        ready: false,
        runtime,
        systemAudio: false,
        systemAudioAccessSource: 'not-checked',
      });
      expect(mocks.probe).not.toHaveBeenCalled();
      expect(mocks.askForMediaAccess).not.toHaveBeenCalled();
    }
  );

  it('accepts a macOS probe capability without calling it during runtime checks', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    mocks.loadNative.mockReturnValue({
      ShareableContent: { probeSystemAudioAccess: mocks.nativeProbe },
    });
    expect(getRecordingRuntimeStatus()).toEqual({
      available: true,
      reason: null,
    });
    expect(mocks.nativeProbe).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('does not require the macOS probe capability on Windows', () => {
    expect(getRecordingRuntimeStatus()).toEqual({
      available: true,
      reason: null,
    });
    expect(mocks.nativeProbe).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('keeps macOS passive until an explicit system audio probe', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    mocks.loadNative.mockReturnValue({
      ShareableContent: { probeSystemAudioAccess: mocks.nativeProbe },
    });
    expect(checkMeetingPermissions()).toMatchObject({
      microphone: true,
      ready: false,
      systemAudio: false,
      systemAudioAccessSource: 'not-checked',
    });
    expect(mocks.probe).not.toHaveBeenCalled();
    mocks.probe.mockReturnValue({
      available: true,
      status: 'granted',
      reason: null,
    });
    expect(
      checkMeetingPermissions({ forceSystemAudioProbe: true })
    ).toMatchObject({
      ready: true,
      systemAudio: true,
      systemAudioAccessSource: 'core-audio-probe',
    });
    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('preserves the macOS microphone request', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    mocks.askForMediaAccess.mockResolvedValue(true);
    await expect(askForMeetingPermission('microphone')).resolves.toBe(true);
    expect(mocks.askForMediaAccess).toHaveBeenCalledExactlyOnceWith(
      'microphone'
    );
  });

  it('does not query unsupported platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    expect(checkMeetingPermissions()).toBeUndefined();
    await expect(askForMeetingPermission('microphone')).resolves.toBe(false);
    expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
    expect(mocks.askForMediaAccess).not.toHaveBeenCalled();
    expect(mocks.loadNative).not.toHaveBeenCalled();
  });
});

describe('recording permission Settings handler', () => {
  const event = {} as Electron.IpcMainInvokeEvent;

  it('opens the Windows microphone pane and propagates its result', async () => {
    await expect(
      recordingHandlers.showRecordingPermissionSetting(event, 'microphone')
    ).resolves.toBe(true);
    expect(
      mocks.openWindowsMicrophoneSettings
    ).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.openMacSystemSettings).not.toHaveBeenCalled();

    mocks.openWindowsMicrophoneSettings.mockResolvedValue(false);
    await expect(
      recordingHandlers.showRecordingPermissionSetting(event, 'microphone')
    ).resolves.toBe(false);
  });

  it.each(['screen', 'systemAudio', 'privacy-camera', '__proto__'])(
    'does not open unrelated Windows Settings for %s',
    async type => {
      await expect(
        recordingHandlers.showRecordingPermissionSetting(
          event,
          type as 'microphone'
        )
      ).resolves.toBe(false);
      expect(mocks.openWindowsMicrophoneSettings).not.toHaveBeenCalled();
      expect(mocks.openMacSystemSettings).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['microphone', 'Privacy_Microphone'],
    ['screen', 'Privacy_ScreenCapture'],
    ['systemAudio', 'Privacy_ScreenCapture'],
  ] as const)('keeps the macOS %s pane', async (type, anchor) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    await expect(
      recordingHandlers.showRecordingPermissionSetting(event, type)
    ).resolves.toBe(true);
    expect(mocks.openMacSystemSettings).toHaveBeenCalledExactlyOnceWith(anchor);
    expect(mocks.openWindowsMicrophoneSettings).not.toHaveBeenCalled();
  });

  it('returns false on unsupported platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    await expect(
      recordingHandlers.showRecordingPermissionSetting(event, 'microphone')
    ).resolves.toBe(false);
    expect(mocks.openMacSystemSettings).not.toHaveBeenCalled();
    expect(mocks.openWindowsMicrophoneSettings).not.toHaveBeenCalled();
  });
});
