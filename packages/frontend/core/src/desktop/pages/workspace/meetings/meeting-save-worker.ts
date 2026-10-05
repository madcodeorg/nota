import {
  deferPendingMeetingSaveForTranscript,
  enqueuePendingMeetingSaveJob,
  markPendingMeetingSaveJobFailed,
  type MeetingSaveStorage,
  promoteTranscriptReadyMeetingSave,
  readPendingMeetingSaveJobs,
  removePendingMeetingSaveJob,
} from './meeting-pending-save';
import {
  isMeetingTranscriptionPending,
  MeetingTranscriptPendingError,
  meetingTranscriptSaveDelta,
} from './meeting-save';
import type { MeetingSaveMeeting } from './meeting-save-executor';

export const PENDING_MEETING_SAVE_WAKE_EVENT = 'nota:pending-meeting-save-wake';
export const MEETING_TRANSCRIPT_PENDING_RETRY_MS = 2_500;

export function browserMeetingSaveStorage(): MeetingSaveStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function notifyPendingMeetingSaveWorker() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDING_MEETING_SAVE_WAKE_EVENT));
  }
}

export function persistPendingMeetingSave(
  workspaceId: string,
  meetingId: string,
  storage = browserMeetingSaveStorage()
) {
  const persisted = storage
    ? enqueuePendingMeetingSaveJob({ meetingId, storage, workspaceId })
    : false;
  if (persisted) {
    notifyPendingMeetingSaveWorker();
  }
  return persisted;
}

export async function discoverPendingMeetingSaves(input: {
  docExists: (docId: string) => boolean;
  listMeetings: () => Promise<MeetingSaveMeeting[]>;
  now?: () => number;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  let discovered = 0;
  for (const meeting of await input.listMeetings()) {
    if (meeting.status !== 'stopped') {
      continue;
    }
    if (isMeetingTranscriptionPending(meeting.stt?.status)) {
      continue;
    }
    const linkedDocExists = Boolean(
      meeting.docId && input.docExists(meeting.docId)
    );
    const transcriptNeedsSave = meetingTranscriptSaveDelta({
      savedTranscriptSegmentIds: meeting.savedTranscriptSegmentIds,
      savedTranscriptSegmentSnapshots: meeting.savedTranscriptSegmentSnapshots,
      transcriptSaveInitialized: meeting.transcriptSaveInitialized,
      transcriptSegments: meeting.transcriptSegments ?? [],
    }).needsSave;
    if (linkedDocExists && !transcriptNeedsSave) {
      continue;
    }
    if (
      enqueuePendingMeetingSaveJob({
        meetingId: meeting.id,
        storage: input.storage,
        workspaceId: input.workspaceId,
      })
    ) {
      promoteTranscriptReadyMeetingSave({
        meetingId: meeting.id,
        now: input.now?.(),
        storage: input.storage,
        workspaceId: input.workspaceId,
      });
      discovered += 1;
    }
  }
  return discovered;
}

export type PendingMeetingSaveProcessResult = {
  nextAttemptInMs: number | null;
  processedMeetingId: string | null;
  succeeded: boolean | null;
};

type ProcessNextPendingMeetingSaveInput = {
  now?: () => number;
  saveMeeting: (meetingId: string) => Promise<unknown>;
  storage: MeetingSaveStorage;
  workspaceId: string;
};

const pendingMeetingSavePasses = new Map<
  string,
  Promise<PendingMeetingSaveProcessResult>
>();

export function processNextPendingMeetingSave(
  input: ProcessNextPendingMeetingSaveInput
): Promise<PendingMeetingSaveProcessResult> {
  const existing = pendingMeetingSavePasses.get(input.workspaceId);
  if (existing) {
    return existing;
  }
  const pass = processNextPendingMeetingSaveInternal(input).finally(() => {
    if (pendingMeetingSavePasses.get(input.workspaceId) === pass) {
      pendingMeetingSavePasses.delete(input.workspaceId);
    }
  });
  pendingMeetingSavePasses.set(input.workspaceId, pass);
  return pass;
}

async function processNextPendingMeetingSaveInternal(
  input: ProcessNextPendingMeetingSaveInput
): Promise<PendingMeetingSaveProcessResult> {
  const startedAt = input.now?.() ?? Date.now();
  const [job] = readPendingMeetingSaveJobs(input.storage, input.workspaceId);
  if (!job) {
    return {
      nextAttemptInMs: null,
      processedMeetingId: null,
      succeeded: null,
    };
  }
  if (job.nextAttemptAt > startedAt) {
    return {
      nextAttemptInMs: job.nextAttemptAt - startedAt,
      processedMeetingId: null,
      succeeded: null,
    };
  }

  let succeeded = false;
  let completedAt = startedAt;
  try {
    await input.saveMeeting(job.meetingId);
    completedAt = input.now?.() ?? Date.now();
    removePendingMeetingSaveJob({
      meetingId: job.meetingId,
      storage: input.storage,
      workspaceId: input.workspaceId,
    });
    succeeded = true;
  } catch (error) {
    completedAt = input.now?.() ?? Date.now();
    if (error instanceof MeetingTranscriptPendingError) {
      deferPendingMeetingSaveForTranscript({
        delayMs: MEETING_TRANSCRIPT_PENDING_RETRY_MS,
        meetingId: job.meetingId,
        now: completedAt,
        storage: input.storage,
        workspaceId: input.workspaceId,
      });
    } else {
      console.warn(`Automatic meeting save failed for ${job.meetingId}`, error);
      markPendingMeetingSaveJobFailed({
        meetingId: job.meetingId,
        now: completedAt,
        storage: input.storage,
        workspaceId: input.workspaceId,
      });
    }
  }

  const [nextJob] = readPendingMeetingSaveJobs(
    input.storage,
    input.workspaceId
  );
  return {
    nextAttemptInMs: nextJob
      ? Math.max(0, nextJob.nextAttemptAt - completedAt)
      : null,
    processedMeetingId: job.meetingId,
    succeeded,
  };
}

export async function runPendingMeetingSavePass(input: {
  docExists: (docId: string) => boolean;
  listMeetings: () => Promise<MeetingSaveMeeting[]>;
  now?: () => number;
  saveMeeting: (meetingId: string) => Promise<unknown>;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  let discovered = 0;
  try {
    discovered = await discoverPendingMeetingSaves(input);
  } catch (error) {
    // A temporary list failure must not prevent already-durable queue entries
    // from being processed.
    console.warn('Failed to discover unsaved meeting notes', error);
  }
  const processed = await processNextPendingMeetingSave(input);
  return { discovered, ...processed };
}
