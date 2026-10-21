import type { FrameworkProvider } from '@nota/infra';
// Vitest is supplied by the root workspace test runner.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onRecordingStatusChanged: vi.fn(),
  isActiveTab: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  isAiEnabled: vi.fn(),
  createDoc: vi.fn(),
  openDoc: vi.fn(),
  transcribe: vi.fn(),
  getAudioAttachment: vi.fn(),
  handleBlockCreationSuccess: vi.fn(),
  handleBlockCreationFailed: vi.fn(),
}));

vi.mock('@nota/core/modules/doc', () => ({ DocsService: 'docs' }));
vi.mock('@nota/core/modules/workbench', () => ({
  WorkbenchService: 'workbench',
}));
vi.mock('@nota/core/modules/media/services/audio-attachment', () => ({
  AudioAttachmentService: 'audio',
}));
vi.mock('@nota/debug', () => ({
  DebugLogger: class {
    debug() {}
    error() {}
  },
}));
vi.mock('@nota/electron-api', () => ({
  apis: {
    ui: { isActiveTab: mocks.isActiveTab },
    recording: {
      handleBlockCreationSuccess: mocks.handleBlockCreationSuccess,
      handleBlockCreationFailed: mocks.handleBlockCreationFailed,
    },
  },
  events: {
    recording: {
      onRecordingStatusChanged: mocks.onRecordingStatusChanged,
    },
  },
}));
vi.mock('@nota/i18n', () => ({ i18nTime: () => 'October 19, 10:00' }));
vi.mock('@nota/track', () => ({ default: {} }));
vi.mock('./utils', () => ({
  getCurrentWorkspace: mocks.getCurrentWorkspace,
  isAiEnabled: mocks.isAiEnabled,
}));

import { setupRecordingEvents } from './recording';

const readyRecording = {
  id: 'recording-1',
  status: 'ready',
  startTime: 1,
  filepath: '/recordings/meeting.opus',
};

async function emitStatus(status: unknown) {
  const callback = mocks.onRecordingStatusChanged.mock.calls[0][0];
  callback(status);
  // The native event callback starts an asynchronous task without returning it.
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('setupRecordingEvents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isActiveTab.mockResolvedValue(true);
    mocks.isAiEnabled.mockReturnValue(true);
    mocks.createDoc.mockReturnValue({ id: 'recording-doc' });
    mocks.getAudioAttachment.mockReturnValue({
      obj: { transcribe: mocks.transcribe },
      [Symbol.dispose]() {},
    });
    mocks.getCurrentWorkspace.mockReturnValue({
      workspace: {
        scope: {
          get: (service: string) => {
            if (service === 'docs') return { createDoc: mocks.createDoc };
            if (service === 'audio') return { get: mocks.getAudioAttachment };
            return { workbench: { openDoc: mocks.openDoc } };
          },
        },
      },
      [Symbol.dispose]() {},
    });
    setupRecordingEvents({} as FrameworkProvider);
  });

  it('leaves meeting-owned recordings to the meeting executor', async () => {
    await emitStatus({ ...readyRecording, meetingId: 'meeting-1' });

    expect(mocks.isActiveTab).not.toHaveBeenCalled();
    expect(mocks.getCurrentWorkspace).not.toHaveBeenCalled();
    expect(mocks.isAiEnabled).not.toHaveBeenCalled();
    expect(mocks.createDoc).not.toHaveBeenCalled();
    expect(mocks.getAudioAttachment).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.handleBlockCreationSuccess).not.toHaveBeenCalled();
    expect(mocks.handleBlockCreationFailed).not.toHaveBeenCalled();
    expect(mocks.openDoc).not.toHaveBeenCalled();
  });

  it('continues creating and opening a page for standalone recordings', async () => {
    await emitStatus(readyRecording);

    expect(mocks.isActiveTab).toHaveBeenCalledOnce();
    expect(mocks.getCurrentWorkspace).toHaveBeenCalledOnce();
    expect(mocks.createDoc).toHaveBeenCalledWith({
      title: 'Recording System Audio October 19, 10:00',
      primaryMode: 'page',
      docProps: { onStoreLoad: expect.any(Function) },
    });
    expect(mocks.openDoc).toHaveBeenCalledWith('recording-doc');
  });

  it.each([null, { ...readyRecording, status: 'recording' }])(
    'ignores non-ready recording events: %s',
    async status => {
      await emitStatus(status);

      expect(mocks.isActiveTab).not.toHaveBeenCalled();
      expect(mocks.getCurrentWorkspace).not.toHaveBeenCalled();
      expect(mocks.createDoc).not.toHaveBeenCalled();
      expect(mocks.handleBlockCreationFailed).not.toHaveBeenCalled();
      expect(mocks.openDoc).not.toHaveBeenCalled();
    }
  );
});
