import { describe, expect, test, vi } from 'vitest';

import type { MeetingSaveStorage } from './meeting-pending-save';
import { readPendingMeetingSaveJobs } from './meeting-pending-save';
import {
  MeetingTranscriptPendingError,
  meetingTranscriptSegmentSnapshot,
} from './meeting-save';
import {
  processNextPendingMeetingSave,
  runPendingMeetingSavePass,
} from './meeting-save-worker';

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

describe('workspace meeting save worker', () => {
  test.each(['revised-content', 'legacy-ids'] as const)(
    'discovers a linked meeting needing %s recovery and skips acknowledged retries',
    async watermark => {
      const storage = createStorage();
      const original = {
        endMs: 1_000,
        id: 'segment-1',
        source: 'mic' as const,
        startMs: 0,
        text: 'Original transcript.',
        type: 'final' as const,
      };
      const latest = { ...original, text: 'The revised transcript.' };
      let snapshots: Record<string, string> | undefined =
        watermark === 'legacy-ids'
          ? undefined
          : { 'segment-1': meetingTranscriptSegmentSnapshot(original) };
      const listMeetings = async () => [
        {
          createdAt: '2026-07-16T13:00:00.000Z',
          docId: 'existing-user-edited-note',
          id: 'meeting-revised',
          savedTranscriptSegmentIds: ['segment-1'],
          savedTranscriptSegmentSnapshots: snapshots,
          status: 'stopped' as const,
          transcriptSaveInitialized: true,
          transcriptSegments: [latest],
          updatedAt: '2026-07-16T13:01:00.000Z',
          workspaceId: 'workspace-1',
        },
      ];
      const saveMeeting = vi.fn(async () => {
        snapshots = { 'segment-1': meetingTranscriptSegmentSnapshot(latest) };
      });
      const input = {
        docExists: () => true,
        listMeetings,
        saveMeeting,
        storage,
        workspaceId: 'workspace-1',
      };

      expect(await runPendingMeetingSavePass(input)).toMatchObject({
        discovered: 1,
        processedMeetingId: 'meeting-revised',
        succeeded: true,
      });
      expect(await runPendingMeetingSavePass(input)).toMatchObject({
        discovered: 0,
        processedMeetingId: null,
      });
      expect(saveMeeting).toHaveBeenCalledOnce();
      expect(readPendingMeetingSaveJobs(storage, 'workspace-1')).toEqual([]);
    }
  );

  test('rediscovers same-ID text updated during the preceding save attempt', async () => {
    const storage = createStorage();
    const segment = {
      endMs: 1_000,
      id: 'segment-1',
      source: 'mic' as const,
      startMs: 0,
      text: 'Fetched transcript.',
      type: 'final' as const,
    };
    let snapshots: Record<string, string> = {};
    const saveMeeting = vi.fn(async () => {
      snapshots = { 'segment-1': meetingTranscriptSegmentSnapshot(segment) };
      segment.text = 'Late text with the same ID.';
    });
    const input = {
      docExists: () => true,
      listMeetings: async () => [
        {
          createdAt: '2026-07-16T13:00:00.000Z',
          docId: 'existing-note',
          id: 'meeting-race',
          savedTranscriptSegmentSnapshots: snapshots,
          status: 'stopped' as const,
          transcriptSaveInitialized: true,
          transcriptSegments: [segment],
          updatedAt: '2026-07-16T13:01:00.000Z',
          workspaceId: 'workspace-1',
        },
      ],
      saveMeeting,
      storage,
      workspaceId: 'workspace-1',
    };
    expect((await runPendingMeetingSavePass(input)).discovered).toBe(1);
    expect((await runPendingMeetingSavePass(input)).discovered).toBe(1);
    expect((await runPendingMeetingSavePass(input)).discovered).toBe(0);
    expect(saveMeeting).toHaveBeenCalledTimes(2);
  });

  test('discovers and saves a stopped meeting without the Meetings route', async () => {
    const storage = createStorage();
    const saveMeeting = vi.fn(async () => ({ docId: 'meeting-note-1' }));

    const result = await runPendingMeetingSavePass({
      docExists: () => false,
      listMeetings: async () => [
        {
          createdAt: '2026-07-16T13:00:00.000Z',
          id: 'meeting-1',
          status: 'stopped',
          transcriptSaveInitialized: false,
          transcriptSegments: [
            {
              endMs: 1_000,
              id: 'segment-1',
              source: 'mic',
              startMs: 0,
              text: 'Persist me from any workspace route.',
              type: 'final',
            },
          ],
          updatedAt: '2026-07-16T13:01:00.000Z',
          workspaceId: 'workspace-1',
        },
      ],
      saveMeeting,
      storage,
      workspaceId: 'workspace-1',
    });

    expect(result.discovered).toBe(1);
    expect(result.processedMeetingId).toBe('meeting-1');
    expect(result.succeeded).toBe(true);
    expect(saveMeeting).toHaveBeenCalledOnce();
    expect(saveMeeting).toHaveBeenCalledWith('meeting-1');
    expect(readPendingMeetingSaveJobs(storage, 'workspace-1')).toEqual([]);
  });

  test('processes a durable queue entry even when discovery is offline', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    storage.setItem(
      'nota:pending-meeting-saves:v1:workspace-1',
      JSON.stringify([
        {
          attemptCount: 0,
          createdAt: 100,
          meetingId: 'meeting-queued',
          nextAttemptAt: 100,
          updatedAt: 100,
          workspaceId: 'workspace-1',
        },
      ])
    );
    const saveMeeting = vi.fn(async () => undefined);

    const result = await runPendingMeetingSavePass({
      docExists: () => false,
      listMeetings: async () => {
        throw new Error('backend temporarily offline');
      },
      saveMeeting,
      storage,
      workspaceId: 'workspace-1',
    });

    expect(result.processedMeetingId).toBe('meeting-queued');
    expect(result.succeeded).toBe(true);
    expect(saveMeeting).toHaveBeenCalledWith('meeting-queued');
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  test('starts failure backoff after a long save attempt completes', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage();
    storage.setItem(
      'nota:pending-meeting-saves:v1:workspace-1',
      JSON.stringify([
        {
          attemptCount: 0,
          createdAt: 0,
          meetingId: 'meeting-slow-failure',
          nextAttemptAt: 0,
          updatedAt: 0,
          workspaceId: 'workspace-1',
        },
      ])
    );
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(10_000);

    const result = await processNextPendingMeetingSave({
      now,
      saveMeeting: async () => {
        throw new Error('slow failure');
      },
      storage,
      workspaceId: 'workspace-1',
    });

    expect(result.nextAttemptInMs).toBe(1_000);
    expect(readPendingMeetingSaveJobs(storage, 'workspace-1')[0]).toMatchObject(
      {
        attemptCount: 1,
        nextAttemptAt: 11_000,
        updatedAt: 10_000,
      }
    );
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  test('does not consume backoff while stopped transcription finalizes and saves immediately when ready', async () => {
    const storage = createStorage();
    storage.setItem(
      'nota:pending-meeting-saves:v1:workspace-1',
      JSON.stringify([
        {
          attemptCount: 0,
          createdAt: 0,
          meetingId: 'meeting-finalizing',
          nextAttemptAt: 0,
          updatedAt: 0,
          workspaceId: 'workspace-1',
        },
      ])
    );
    let now = 100;
    let sttStatus: 'finalizing' | 'stopped' = 'finalizing';
    const listMeetings = async () => [
      {
        createdAt: '2026-07-16T13:00:00.000Z',
        id: 'meeting-finalizing',
        status: 'stopped' as const,
        stt: { status: sttStatus },
        transcriptSaveInitialized: false,
        transcriptSegments: [],
        updatedAt: '2026-07-16T13:01:00.000Z',
        workspaceId: 'workspace-1',
      },
    ];
    const saveMeeting = vi.fn(async () => {
      if (sttStatus === 'finalizing') {
        throw new MeetingTranscriptPendingError();
      }
      return { docId: 'meeting-note-finalized' };
    });

    const deferred = await runPendingMeetingSavePass({
      docExists: () => false,
      listMeetings,
      now: () => now,
      saveMeeting,
      storage,
      workspaceId: 'workspace-1',
    });
    expect(deferred.succeeded).toBe(false);
    expect(readPendingMeetingSaveJobs(storage, 'workspace-1')[0]).toMatchObject(
      {
        attemptCount: 0,
        deferredReason: 'transcript-pending',
        nextAttemptAt: 2_600,
      }
    );

    now = 500;
    sttStatus = 'stopped';
    const finalized = await runPendingMeetingSavePass({
      docExists: () => false,
      listMeetings,
      now: () => now,
      saveMeeting,
      storage,
      workspaceId: 'workspace-1',
    });

    expect(finalized.processedMeetingId).toBe('meeting-finalizing');
    expect(finalized.succeeded).toBe(true);
    expect(saveMeeting).toHaveBeenCalledTimes(2);
    expect(readPendingMeetingSaveJobs(storage, 'workspace-1')).toEqual([]);
  });
});
