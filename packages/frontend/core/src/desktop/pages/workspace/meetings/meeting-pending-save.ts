export type MeetingSaveStorage = Pick<
  Storage,
  'getItem' | 'removeItem' | 'setItem'
>;

export type PendingMeetingSaveJob = {
  attemptCount: number;
  createdAt: number;
  deferredReason?: 'transcript-pending';
  meetingId: string;
  nextAttemptAt: number;
  updatedAt: number;
  workspaceId: string;
};

export const PENDING_MEETING_SAVE_RETRY_DELAYS_MS = [
  1000,
  2500,
  5000,
  10_000,
  30_000,
  60_000,
  5 * 60_000,
] as const;

function pendingMeetingSaveStorageKey(workspaceId: string) {
  return `nota:pending-meeting-saves:v1:${workspaceId}`;
}

function isPendingMeetingSaveJob(
  value: unknown,
  workspaceId: string
): value is PendingMeetingSaveJob {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const job = value as Partial<PendingMeetingSaveJob>;
  return (
    job.workspaceId === workspaceId &&
    typeof job.meetingId === 'string' &&
    job.meetingId.trim().length > 0 &&
    Number.isSafeInteger(job.attemptCount) &&
    (job.attemptCount ?? -1) >= 0 &&
    typeof job.createdAt === 'number' &&
    Number.isFinite(job.createdAt) &&
    typeof job.updatedAt === 'number' &&
    Number.isFinite(job.updatedAt) &&
    typeof job.nextAttemptAt === 'number' &&
    Number.isFinite(job.nextAttemptAt)
  );
}

export function readPendingMeetingSaveJobs(
  storage: MeetingSaveStorage,
  workspaceId: string
) {
  try {
    const raw = storage.getItem(pendingMeetingSaveStorageKey(workspaceId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(job => isPendingMeetingSaveJob(job, workspaceId))
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          left.createdAt - right.createdAt ||
          left.meetingId.localeCompare(right.meetingId)
      );
  } catch {
    return [];
  }
}

function writePendingMeetingSaveJobs(
  storage: MeetingSaveStorage,
  workspaceId: string,
  jobs: PendingMeetingSaveJob[]
) {
  try {
    const key = pendingMeetingSaveStorageKey(workspaceId);
    if (jobs.length) {
      storage.setItem(key, JSON.stringify(jobs));
    } else {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

export function enqueuePendingMeetingSaveJob(input: {
  meetingId: string;
  now?: number;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  const meetingId = input.meetingId.trim();
  if (!meetingId) {
    return false;
  }
  const jobs = readPendingMeetingSaveJobs(input.storage, input.workspaceId);
  if (jobs.some(job => job.meetingId === meetingId)) {
    return true;
  }
  const now = input.now ?? Date.now();
  jobs.push({
    attemptCount: 0,
    createdAt: now,
    meetingId,
    nextAttemptAt: now,
    updatedAt: now,
    workspaceId: input.workspaceId,
  });
  return writePendingMeetingSaveJobs(input.storage, input.workspaceId, jobs);
}

export function markPendingMeetingSaveJobFailed(input: {
  meetingId: string;
  now?: number;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  const jobs = readPendingMeetingSaveJobs(input.storage, input.workspaceId);
  const job = jobs.find(job => job.meetingId === input.meetingId);
  if (!job) {
    return false;
  }
  const now = input.now ?? Date.now();
  delete job.deferredReason;
  job.attemptCount += 1;
  job.updatedAt = now;
  job.nextAttemptAt =
    now +
    PENDING_MEETING_SAVE_RETRY_DELAYS_MS[
      Math.min(
        job.attemptCount - 1,
        PENDING_MEETING_SAVE_RETRY_DELAYS_MS.length - 1
      )
    ];
  return writePendingMeetingSaveJobs(input.storage, input.workspaceId, jobs);
}

export function deferPendingMeetingSaveForTranscript(input: {
  delayMs: number;
  meetingId: string;
  now?: number;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  const jobs = readPendingMeetingSaveJobs(input.storage, input.workspaceId);
  const job = jobs.find(job => job.meetingId === input.meetingId);
  if (!job) {
    return false;
  }
  const now = input.now ?? Date.now();
  job.deferredReason = 'transcript-pending';
  job.nextAttemptAt = now + input.delayMs;
  job.updatedAt = now;
  return writePendingMeetingSaveJobs(input.storage, input.workspaceId, jobs);
}

export function promoteTranscriptReadyMeetingSave(input: {
  meetingId: string;
  now?: number;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  const jobs = readPendingMeetingSaveJobs(input.storage, input.workspaceId);
  const job = jobs.find(job => job.meetingId === input.meetingId);
  if (!job || job.deferredReason !== 'transcript-pending') {
    return false;
  }
  const now = input.now ?? Date.now();
  delete job.deferredReason;
  job.nextAttemptAt = Math.min(job.nextAttemptAt, now);
  job.updatedAt = now;
  return writePendingMeetingSaveJobs(input.storage, input.workspaceId, jobs);
}

export function removePendingMeetingSaveJob(input: {
  meetingId: string;
  storage: MeetingSaveStorage;
  workspaceId: string;
}) {
  const jobs = readPendingMeetingSaveJobs(input.storage, input.workspaceId);
  return writePendingMeetingSaveJobs(
    input.storage,
    input.workspaceId,
    jobs.filter(job => job.meetingId !== input.meetingId)
  );
}
