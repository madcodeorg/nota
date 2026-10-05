import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { DocsService } from '@nota/core/modules/doc';
import { JournalService } from '@nota/core/modules/journal';
import { MeetingSettingsService } from '@nota/core/modules/media/services/meeting-settings';
import { GuardService } from '@nota/core/modules/permissions';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import {
  useFramework,
  useLiveData,
  useService,
  useServiceOptional,
} from '@nota/infra';
import { useEffect, useMemo } from 'react';

import {
  createMeetingSavePermissionContext,
  executeMeetingSaveOnce,
  finalizePortableMeetingMicRecording,
  type MeetingSaveMeeting,
  type MeetingSaveMicExportAccess,
  workspaceDocExists,
} from './meeting-save-executor';
import {
  browserMeetingSaveStorage,
  PENDING_MEETING_SAVE_WAKE_EVENT,
  runPendingMeetingSavePass,
} from './meeting-save-worker';

const MEETING_SAVE_DISCOVERY_INTERVAL_MS = 30_000;

function aiBackendUrl(path: string) {
  return new URL(path, location.href).toString();
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(aiBackendUrl(url), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

function supportsMicAudioExport(
  value: unknown
): value is MeetingSaveMicExportAccess {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const handler = value as Partial<MeetingSaveMicExportAccess>;
  return (
    typeof handler.getMicAudioSpoolStatus === 'function' &&
    typeof handler.getPublishedMicRecordingPath === 'function' &&
    typeof handler.publishMicRecording === 'function' &&
    typeof handler.readMicAudioSpoolArchive === 'function'
  );
}

/**
 * Keeps durable meeting-note discovery and retries alive for the opened
 * workspace, independently of which workspace route is visible.
 */
export const MeetingSaveSideEffect = () => {
  const framework = useFramework();
  const desktopApi = useServiceOptional(DesktopApiService);
  const docsService = useService(DocsService);
  const journalService = useService(JournalService);
  const meetingSettingsService = useService(MeetingSettingsService);
  const meetingSettings = useLiveData(meetingSettingsService.settings$);
  const workspace = useService(WorkspaceService).workspace;
  const workspaceId = workspace.id;
  const permissions = useMemo(
    () =>
      createMeetingSavePermissionContext({
        guardService: framework.getOptional(GuardService),
        userOwnedWorkspace: isUserOwnedWorkspaceFlavour(workspace.flavour),
      }),
    [framework, workspace.flavour]
  );

  useEffect(() => {
    const storage = browserMeetingSaveStorage();
    if (!storage) {
      return;
    }

    let disposed = false;
    let running = false;
    let rerunRequested = false;
    let timerId: number | null = null;
    const recordingHandler = desktopApi?.handler.recording;
    const micExportHandler = supportsMicAudioExport(recordingHandler)
      ? recordingHandler
      : null;

    const schedule = (delayMs: number) => {
      if (disposed) {
        return;
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(
        () => {
          timerId = null;
          run().catch(error => {
            console.warn('Failed to start workspace meeting-save pass', error);
          });
        },
        Math.min(delayMs, MEETING_SAVE_DISCOVERY_INTERVAL_MS)
      );
    };

    const saveMeeting = async (meetingId: string) => {
      const result = await executeMeetingSaveOnce({
        ...permissions,
        docPersistence: workspace.engine.doc,
        docsService,
        finalizePortableMicRecording: micExportHandler
          ? targetMeetingId =>
              finalizePortableMeetingMicRecording(
                micExportHandler,
                targetMeetingId
              )
          : undefined,
        getMeeting: async targetMeetingId => {
          const data = await jsonRequest<{ meeting: MeetingSaveMeeting }>(
            `/v1/meetings/${targetMeetingId}`
          );
          return data.meeting;
        },
        journalService,
        patchMeeting: async (targetMeetingId, update) => {
          const data = await jsonRequest<{ meeting: MeetingSaveMeeting }>(
            `/v1/meetings/${targetMeetingId}`,
            { body: JSON.stringify(update), method: 'PATCH' }
          );
          return data.meeting;
        },
        recordingAccess: recordingHandler,
        recordingSavingMode: meetingSettings.recordingSavingMode,
        storage,
        targetMeetingId: meetingId,
        workspace: workspace.docCollection,
        workspaceId,
      });
      window.dispatchEvent(new CustomEvent('nota:meetings-history-refresh'));
      return result;
    };

    const run = async () => {
      if (running) {
        rerunRequested = true;
        return;
      }
      running = true;
      let nextAttemptInMs: number | null = null;
      try {
        const result = await runPendingMeetingSavePass({
          docExists: docId =>
            workspaceDocExists(workspace.docCollection, docId),
          listMeetings: async () => {
            const params = new URLSearchParams({ workspaceId });
            const data = await jsonRequest<{
              meetings: MeetingSaveMeeting[];
            }>(`/v1/meetings?${params.toString()}`);
            return data.meetings;
          },
          saveMeeting,
          storage,
          workspaceId,
        });
        nextAttemptInMs = result.nextAttemptInMs;
      } catch (error) {
        console.warn('Unexpected workspace meeting-save worker failure', error);
        nextAttemptInMs = 1_000;
      } finally {
        running = false;
      }

      if (disposed) {
        return;
      }
      if (rerunRequested) {
        rerunRequested = false;
        schedule(0);
      } else {
        schedule(nextAttemptInMs ?? MEETING_SAVE_DISCOVERY_INTERVAL_MS);
      }
    };

    const wake = () => {
      if (running) {
        rerunRequested = true;
      } else {
        schedule(0);
      }
    };
    window.addEventListener(PENDING_MEETING_SAVE_WAKE_EVENT, wake);
    window.addEventListener('storage', wake);
    run().catch(error => {
      console.warn('Failed to start workspace meeting-save pass', error);
    });

    return () => {
      disposed = true;
      window.removeEventListener(PENDING_MEETING_SAVE_WAKE_EVENT, wake);
      window.removeEventListener('storage', wake);
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    desktopApi,
    docsService,
    journalService,
    meetingSettings.recordingSavingMode,
    permissions,
    workspace.docCollection,
    workspace.engine.doc,
    workspaceId,
  ]);

  return null;
};
