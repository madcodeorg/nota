import { describe, expect, test } from 'vitest';

import {
  enqueuePendingMeetingSaveJob,
  markPendingMeetingSaveJobFailed,
  type MeetingSaveStorage,
  PENDING_MEETING_SAVE_RETRY_DELAYS_MS,
  readPendingMeetingSaveJobs,
  removePendingMeetingSaveJob,
} from './meeting-pending-save';

function createStorage(): MeetingSaveStorage {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    removeItem: key => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('pending meeting save jobs', () => {
  test('persists and deduplicates a canonical-save job across reloads', () => {
    const storage = createStorage();

    expect(
      enqueuePendingMeetingSaveJob({
        meetingId: 'meeting-1',
        now: 100,
        storage,
        workspaceId: 'workspace-1',
      })
    ).toBe(true);
    expect(
      enqueuePendingMeetingSaveJob({
        meetingId: 'meeting-1',
        now: 200,
        storage,
        workspaceId: 'workspace-1',
      })
    ).toBe(true);

    expect(readPendingMeetingSaveJobs(storage, 'workspace-1')).toEqual([
      {
        attemptCount: 0,
        createdAt: 100,
        meetingId: 'meeting-1',
        nextAttemptAt: 100,
        updatedAt: 100,
        workspaceId: 'workspace-1',
      },
    ]);
  });

  test('keeps retrying with a capped delay instead of exhausting the job', () => {
    const storage = createStorage();
    enqueuePendingMeetingSaveJob({
      meetingId: 'meeting-1',
      now: 0,
      storage,
      workspaceId: 'workspace-1',
    });

    for (let attempt = 1; attempt <= 12; attempt++) {
      const now = attempt * 1000;
      expect(
        markPendingMeetingSaveJobFailed({
          meetingId: 'meeting-1',
          now,
          storage,
          workspaceId: 'workspace-1',
        })
      ).toBe(true);
      const [job] = readPendingMeetingSaveJobs(storage, 'workspace-1');
      expect(job.attemptCount).toBe(attempt);
      expect(job.nextAttemptAt).toBe(
        now +
          PENDING_MEETING_SAVE_RETRY_DELAYS_MS[
            Math.min(
              attempt - 1,
              PENDING_MEETING_SAVE_RETRY_DELAYS_MS.length - 1
            )
          ]
      );
    }
  });

  test('removes only the completed workspace job', () => {
    const storage = createStorage();
    for (const meetingId of ['meeting-1', 'meeting-2']) {
      enqueuePendingMeetingSaveJob({
        meetingId,
        now: 100,
        storage,
        workspaceId: 'workspace-1',
      });
    }
    enqueuePendingMeetingSaveJob({
      meetingId: 'meeting-other',
      now: 100,
      storage,
      workspaceId: 'workspace-2',
    });

    expect(
      removePendingMeetingSaveJob({
        meetingId: 'meeting-1',
        storage,
        workspaceId: 'workspace-1',
      })
    ).toBe(true);
    expect(
      readPendingMeetingSaveJobs(storage, 'workspace-1').map(
        job => job.meetingId
      )
    ).toEqual(['meeting-2']);
    expect(
      readPendingMeetingSaveJobs(storage, 'workspace-2').map(
        job => job.meetingId
      )
    ).toEqual(['meeting-other']);
  });

  test('ignores corrupt or cross-workspace records', () => {
    const storage = createStorage();
    storage.setItem(
      'nota:pending-meeting-saves:v1:workspace-1',
      JSON.stringify([
        null,
        { meetingId: 'broken' },
        {
          attemptCount: 0,
          createdAt: 1,
          meetingId: 'wrong-workspace',
          nextAttemptAt: 1,
          updatedAt: 1,
          workspaceId: 'workspace-2',
        },
      ])
    );

    expect(readPendingMeetingSaveJobs(storage, 'workspace-1')).toEqual([]);
  });
});
