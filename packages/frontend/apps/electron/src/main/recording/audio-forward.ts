import fs from 'node:fs';
import fsp from 'node:fs/promises';

import { fetchAiBackend } from '../ai-backend';
import { logger } from '../logger';

// Live meeting audio transport: the native tap callback pushes system-audio
// samples here and we POST them straight to the local AI backend as raw
// binary f32le PCM. The raw archive remains the lossless source of truth for
// recovery whenever live forwarding stalls.

const FLUSH_INTERVAL_MS = 100;
const POST_MAX_BYTES = 1024 * 1024; // stay under the backend's 2MB frame cap
const PENDING_MAX_SECONDS = 30; // bound live-forward memory if the backend stalls
const MAX_CONSECUTIVE_FAILURES = 50; // ~5s of failed posts -> archive fallback
const FINAL_POST_ATTEMPTS = 3;
const ARCHIVE_READY_TIMEOUT_MS = 10_000;
const ARCHIVE_READY_POLL_MS = 25;
const DRAIN_RESULT_CACHE_MAX = 100;

export type AudioForwardDrainResult = {
  // Expected final byte boundary in the raw archive. This can exceed the file
  // size when the archive itself was truncated, which lets the renderer show
  // a real failure instead of trusting a partial file.
  archive: number;
  complete: boolean;
  // Last byte acknowledged by the meeting audio-frame endpoint.
  cursor: number;
  reason: string | null;
};

interface AudioForwardSession {
  acknowledgedByteCursor: number;
  archiveFilePath: string | null;
  archiveFallbackReason: string | null;
  captureStopped: boolean;
  capturedByteCursor: number;
  channels: number;
  consecutiveFailures: number;
  draining: Promise<AudioForwardDrainResult> | null;
  flushing: Promise<void> | null;
  meetingId: string;
  pending: Float32Array[];
  pendingSamples: number;
  // A batch leaves the live queue before its POST starts. Keep that exact
  // byte range separate until the backend acknowledges it so a lost response
  // cannot merge the retry with newer samples and change its frame ID.
  retryBatch: Float32Array | null;
  // Resolves once audio captured before forwarding started is queued. Live
  // flushing waits on this so frames reach the backend in archive order.
  ready: Promise<void>;
  recordingId: number;
  sampleRate: number;
  stopped: boolean;
  timer: NodeJS.Timeout | null;
}

const sessionsByRecordingId = new Map<number, AudioForwardSession>();
const sessionsByMeetingId = new Map<string, AudioForwardSession>();
const drainResultsByMeetingId = new Map<string, AudioForwardDrainResult>();

function audioFrameBytes(session: AudioForwardSession) {
  return Float32Array.BYTES_PER_ELEMENT * session.channels;
}

function alignedByteCursor(session: AudioForwardSession, cursor: number) {
  const frameBytes = audioFrameBytes(session);
  return Math.max(0, Math.floor(cursor / frameBytes) * frameBytes);
}

function bytesToMs(session: AudioForwardSession, bytes: number) {
  return Math.round(
    (bytes /
      Float32Array.BYTES_PER_ELEMENT /
      session.channels /
      session.sampleRate) *
      1000
  );
}

function takePending(session: AudioForwardSession, maxBytes: number) {
  const maxSamples = Math.floor(maxBytes / Float32Array.BYTES_PER_ELEMENT);
  let count = 0;
  const parts: Float32Array[] = [];
  while (session.pending.length && count < maxSamples) {
    const head = session.pending[0];
    if (count + head.length <= maxSamples) {
      parts.push(head);
      count += head.length;
      session.pending.shift();
    } else {
      const take = maxSamples - count;
      parts.push(head.subarray(0, take));
      session.pending[0] = head.subarray(take);
      count += take;
    }
  }
  session.pendingSamples -= count;
  if (parts.length === 1) {
    return parts[0];
  }
  const merged = new Float32Array(count);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.length;
  }
  return merged;
}

async function postFrame(session: AudioForwardSession, samples: Float32Array) {
  const startByte = session.acknowledgedByteCursor;
  const endByte = startByte + samples.byteLength;
  const params = new URLSearchParams({
    channels: String(session.channels),
    endMs: String(bytesToMs(session, endByte)),
    frameId: `system:${startByte}:${endByte}`,
    sampleRate: String(session.sampleRate),
    source: 'system',
    startMs: String(bytesToMs(session, startByte)),
  });
  const body = Buffer.from(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength
  );
  const response = await fetchAiBackend(
    `/v1/meetings/${session.meetingId}/audio-frame?${params.toString()}`,
    {
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
      method: 'POST',
    }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      (data as { error?: string } | null)?.error ??
        `Audio frame post failed: ${response.status}`
    );
  }
  session.acknowledgedByteCursor = endByte;
}

function stopFlushTimer(session: AudioForwardSession) {
  if (session.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }
}

function switchToArchiveFallback(
  session: AudioForwardSession,
  reason: string,
  error?: unknown
) {
  session.archiveFallbackReason ??= reason;
  // The archive replaces audio that has not entered a POST yet. An in-flight
  // or failed batch must survive so final drain retries its identical frame
  // before continuing from the archive cursor.
  session.pending = [];
  session.pendingSamples = 0;
  stopFlushTimer(session);
  if (error) {
    logger.error(`[audio-forward] ${reason}`, error);
  } else {
    logger.warn(`[audio-forward] ${reason}`);
  }
}

function flushSession(session: AudioForwardSession) {
  if (session.flushing) {
    return session.flushing;
  }
  if (
    session.stopped ||
    session.captureStopped ||
    session.archiveFallbackReason
  ) {
    return Promise.resolve();
  }

  const flush = (async () => {
    await session.ready;
    while (
      !session.captureStopped &&
      !session.archiveFallbackReason &&
      (session.retryBatch !== null || session.pendingSamples > 0)
    ) {
      const samples =
        session.retryBatch ?? takePending(session, POST_MAX_BYTES);
      session.retryBatch = samples;
      try {
        await postFrame(session, samples);
        if (session.retryBatch === samples) {
          session.retryBatch = null;
        }
        session.consecutiveFailures = 0;
      } catch (error) {
        // Keep this exact batch outside the live queue. Newer samples can
        // continue accumulating without changing the retry frame ID/body.
        session.consecutiveFailures++;
        if (session.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          switchToArchiveFallback(
            session,
            `switching meeting ${session.meetingId} to raw archive after repeated post failures`,
            error
          );
        }
        return;
      }
    }
  })();
  session.flushing = flush;
  const clearFlush = () => {
    if (session.flushing === flush) {
      session.flushing = null;
    }
  };
  void flush.then(clearFlush, clearFlush);
  return flush;
}

function checkPendingOverflow(session: AudioForwardSession) {
  const maxSamples =
    session.sampleRate * session.channels * PENDING_MAX_SECONDS;
  if (session.pendingSamples > maxSamples) {
    switchToArchiveFallback(
      session,
      `switching meeting ${session.meetingId} to raw archive after live queue overflow`
    );
  }
}

function removeSession(session: AudioForwardSession) {
  session.stopped = true;
  stopFlushTimer(session);
  if (sessionsByRecordingId.get(session.recordingId) === session) {
    sessionsByRecordingId.delete(session.recordingId);
  }
  if (sessionsByMeetingId.get(session.meetingId) === session) {
    sessionsByMeetingId.delete(session.meetingId);
  }
}

function rememberDrainResult(
  meetingId: string,
  result: AudioForwardDrainResult
) {
  drainResultsByMeetingId.delete(meetingId);
  drainResultsByMeetingId.set(meetingId, result);
  while (drainResultsByMeetingId.size > DRAIN_RESULT_CACHE_MAX) {
    const oldest = drainResultsByMeetingId.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    drainResultsByMeetingId.delete(oldest);
  }
}

async function archiveSize(filePath: string) {
  return fsp
    .stat(filePath)
    .then(stats => stats.size)
    .catch(() => 0);
}

async function waitForArchiveSize(filePath: string, minimumBytes: number) {
  const deadline = Date.now() + ARCHIVE_READY_TIMEOUT_MS;
  while ((await archiveSize(filePath)) < minimumBytes) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Raw archive did not reach ${minimumBytes} bytes before backfill timeout.`
      );
    }
    await new Promise<void>(resolve => {
      setTimeout(resolve, ARCHIVE_READY_POLL_MS);
    });
  }
}

async function readArchiveSamples(
  file: fsp.FileHandle,
  fromByte: number,
  length: number
) {
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await file.read(
      buffer,
      bytesRead,
      length - bytesRead,
      fromByte + bytesRead
    );
    if (!result.bytesRead) break;
    bytesRead += result.bytesRead;
  }
  const alignedLength =
    Math.floor(bytesRead / Float32Array.BYTES_PER_ELEMENT) *
    Float32Array.BYTES_PER_ELEMENT;
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    alignedLength / Float32Array.BYTES_PER_ELEMENT
  );
}

// Audio captured before the meeting session existed is queued ahead of live
// samples. archiveStartByte is the logical write cursor from the recorder, so
// this waits for buffered file writes rather than mistaking a short stat for
// the true live-audio boundary.
async function queueInitialArchiveBackfill(
  session: AudioForwardSession,
  fromByte: number,
  archiveStartByte: number
) {
  if (!session.archiveFilePath || archiveStartByte <= fromByte) return;
  await waitForArchiveSize(session.archiveFilePath, archiveStartByte);
  const file = await fsp.open(session.archiveFilePath, 'r');
  try {
    while (
      session.acknowledgedByteCursor < archiveStartByte &&
      !session.stopped &&
      !session.archiveFallbackReason
    ) {
      const length = alignedByteCursor(
        session,
        Math.min(
          POST_MAX_BYTES,
          archiveStartByte - session.acknowledgedByteCursor
        )
      );
      if (!length) break;
      const samples = await readArchiveSamples(
        file,
        session.acknowledgedByteCursor,
        length
      );
      if (!samples.length) {
        throw new Error(
          `Raw archive ended unexpectedly at byte ${session.acknowledgedByteCursor}.`
        );
      }
      // Post directly while holding only one bounded archive slice. Live
      // samples remain in the normal queue and cannot pass this ready barrier,
      // so the backend still receives the archive in exact chronological order.
      await postFrame(session, samples);
    }
  } finally {
    await file.close();
  }
}

/** Called from the native tap callback with interleaved f32 samples. */
export function forwardAudioSamples(
  recordingId: number,
  samples: Float32Array
) {
  const session = sessionsByRecordingId.get(recordingId);
  if (
    !session ||
    session.stopped ||
    session.captureStopped ||
    !samples.length
  ) {
    return;
  }

  // Track every captured byte even after live forwarding falls back. The
  // final archive must reach this boundary or the drain is explicitly failed.
  session.capturedByteCursor += samples.byteLength;
  if (session.archiveFallbackReason) {
    return;
  }

  // The NAPI callback hands over a fresh array per call and nothing here
  // mutates it, so we can hold the reference without copying.
  session.pending.push(samples);
  session.pendingSamples += samples.length;
  checkPendingOverflow(session);
}

export function startMeetingAudioForward(input: {
  // Exact logical byte cursor already accepted by the recording archive when
  // the session is registered. This avoids a gap when fs.stat lags WriteStream.
  archiveBytes?: number;
  channels: number;
  filePath?: string | null;
  // Byte offset into the raw recording file that has already been posted.
  // Audio from here to archiveBytes is backfilled before live samples.
  fromByte?: number;
  meetingId: string;
  recordingId: number;
  sampleRate: number;
}) {
  const existing = sessionsByMeetingId.get(input.meetingId);
  if (existing && existing.recordingId === input.recordingId) {
    return { active: true };
  }
  if (existing) {
    return {
      active: false,
      reason:
        'A different native recording is already forwarding this meeting.',
    };
  }

  const existingRecording = sessionsByRecordingId.get(input.recordingId);
  if (existingRecording) {
    return {
      active: false,
      reason: 'This native recording is already forwarding another meeting.',
    };
  }

  let statBytes = 0;
  if (input.filePath) {
    try {
      statBytes = fs.statSync(input.filePath).size;
    } catch {
      // The archive may not have flushed its first frame yet.
    }
  }

  const channels = Math.max(1, input.channels);
  const frameBytes = Float32Array.BYTES_PER_ELEMENT * channels;
  const align = (cursor: number) =>
    Math.max(0, Math.floor(cursor / frameBytes) * frameBytes);
  const archiveStartByte = align(Math.max(statBytes, input.archiveBytes ?? 0));
  const backfill = input.fromByte !== undefined;
  const fromByte = backfill
    ? Math.min(archiveStartByte, align(input.fromByte ?? 0))
    : archiveStartByte;

  const session: AudioForwardSession = {
    acknowledgedByteCursor: fromByte,
    archiveFilePath: input.filePath ?? null,
    archiveFallbackReason: null,
    captureStopped: false,
    capturedByteCursor: archiveStartByte,
    channels,
    consecutiveFailures: 0,
    draining: null,
    flushing: null,
    meetingId: input.meetingId,
    pending: [],
    pendingSamples: 0,
    retryBatch: null,
    ready: Promise.resolve(),
    recordingId: input.recordingId,
    sampleRate: Math.max(8000, input.sampleRate),
    stopped: false,
    timer: null,
  };
  sessionsByRecordingId.set(input.recordingId, session);
  sessionsByMeetingId.set(input.meetingId, session);
  drainResultsByMeetingId.delete(input.meetingId);

  if (backfill && session.archiveFilePath && archiveStartByte > fromByte) {
    session.ready = queueInitialArchiveBackfill(
      session,
      fromByte,
      archiveStartByte
    ).catch(error => {
      switchToArchiveFallback(
        session,
        `switching meeting ${session.meetingId} to raw archive after initial backfill failure`,
        error
      );
    });
  }

  session.timer = setInterval(() => {
    flushSession(session).catch(error => {
      logger.error('[audio-forward] flush failed', error);
    });
  }, FLUSH_INTERVAL_MS);

  logger.info(
    `[audio-forward] started meeting=${input.meetingId} recording=${input.recordingId} rate=${session.sampleRate} channels=${session.channels} fromByte=${fromByte} archiveStart=${archiveStartByte}`
  );
  return { active: true };
}

export function markAudioForwardCaptureStopped(recordingId: number) {
  const session = sessionsByRecordingId.get(recordingId);
  if (!session) return;
  session.captureStopped = true;
  stopFlushTimer(session);
}

async function postWithFinalRetries(
  session: AudioForwardSession,
  samples: Float32Array
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < FINAL_POST_ATTEMPTS; attempt++) {
    try {
      await postFrame(session, samples);
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError instanceof Error ? lastError.message : String(lastError);
}

async function drainPendingWithoutArchive(session: AudioForwardSession) {
  while (session.retryBatch || session.pendingSamples > 0) {
    const samples = session.retryBatch ?? takePending(session, POST_MAX_BYTES);
    session.retryBatch = samples;
    const reason = await postWithFinalRetries(session, samples);
    if (reason) {
      return reason;
    }
    if (session.retryBatch === samples) {
      session.retryBatch = null;
    }
  }
  return null;
}

async function drainRetryBatch(session: AudioForwardSession) {
  const samples = session.retryBatch;
  if (!samples) return null;
  const reason = await postWithFinalRetries(session, samples);
  if (!reason && session.retryBatch === samples) {
    session.retryBatch = null;
  }
  return reason;
}

async function postFinalArchive(
  session: AudioForwardSession,
  archiveBytes: number
) {
  if (!session.archiveFilePath) {
    return 'Raw audio archive is unavailable.';
  }
  const file = await fsp.open(session.archiveFilePath, 'r');
  try {
    while (session.acknowledgedByteCursor < archiveBytes) {
      const remaining = archiveBytes - session.acknowledgedByteCursor;
      const length = alignedByteCursor(
        session,
        Math.min(POST_MAX_BYTES, remaining)
      );
      if (!length) break;
      const samples = await readArchiveSamples(
        file,
        session.acknowledgedByteCursor,
        length
      );
      if (!samples.length) {
        return `Raw archive ended at byte ${session.acknowledgedByteCursor}.`;
      }
      // Keep a failed archive window under the same ownership rule as live
      // audio. The archive may grow before a second Stop; without this saved
      // slice, that retry could become a larger frame with a different ID.
      session.retryBatch = samples;
      const reason = await postWithFinalRetries(session, samples);
      if (reason) return reason;
      if (session.retryBatch === samples) {
        session.retryBatch = null;
      }
    }
    return null;
  } finally {
    await file.close();
  }
}

function currentIncompleteResult(
  session: AudioForwardSession,
  reason: string
): AudioForwardDrainResult {
  return {
    archive: Math.max(
      session.capturedByteCursor,
      session.acknowledgedByteCursor
    ),
    complete: false,
    cursor: session.acknowledgedByteCursor,
    reason,
  };
}

function drainSession(session: AudioForwardSession) {
  if (session.draining) {
    return session.draining;
  }
  const draining = (async () => {
    stopFlushTimer(session);
    await session.ready;
    await session.flushing?.catch(error => {
      logger.error(
        '[audio-forward] in-flight flush failed during drain',
        error
      );
    });

    let finalArchiveSize = 0;
    if (session.archiveFilePath) {
      finalArchiveSize = alignedByteCursor(
        session,
        await archiveSize(session.archiveFilePath)
      );
    }
    const expectedArchiveBoundary = Math.max(
      finalArchiveSize,
      session.capturedByteCursor,
      session.acknowledgedByteCursor
    );

    let failureReason: string | null = null;
    if (session.archiveFilePath) {
      // Preserve an unacknowledged live batch byte-for-byte before using the
      // finalized archive for everything newer. Once it is acknowledged, the
      // archive starts at the advanced cursor and cannot duplicate it.
      failureReason = await drainRetryBatch(session);
      session.pending = [];
      session.pendingSamples = 0;
      if (!failureReason && session.acknowledgedByteCursor < finalArchiveSize) {
        failureReason = await postFinalArchive(session, finalArchiveSize);
      }
      if (
        !failureReason &&
        finalArchiveSize < session.capturedByteCursor &&
        session.acknowledgedByteCursor < session.capturedByteCursor
      ) {
        failureReason = `Raw archive is truncated at ${finalArchiveSize} bytes; expected ${session.capturedByteCursor}.`;
      }
    } else if (session.archiveFallbackReason) {
      failureReason = `${session.archiveFallbackReason}; raw audio archive is unavailable.`;
    } else {
      failureReason = await drainPendingWithoutArchive(session);
    }

    const complete =
      !failureReason &&
      session.acknowledgedByteCursor >= expectedArchiveBoundary;
    const reason = complete
      ? session.archiveFallbackReason
        ? `Recovered from raw archive: ${session.archiveFallbackReason}`
        : null
      : (failureReason ??
        `Audio drain stopped at byte ${session.acknowledgedByteCursor} of ${expectedArchiveBoundary}.`);
    const result: AudioForwardDrainResult = {
      archive: expectedArchiveBoundary,
      complete,
      cursor: session.acknowledgedByteCursor,
      reason,
    };
    rememberDrainResult(session.meetingId, result);
    // A failed drain is recoverable: keep the exact retry batch, archive
    // cursor, and session lookup alive so another Stop can finish delivery.
    // Only a complete acknowledgement makes it safe to discard the session.
    if (complete) {
      removeSession(session);
    }
    return result;
  })();
  session.draining = draining;
  const resetIncompleteDrain = () => {
    if (!session.stopped && session.draining === draining) {
      session.draining = null;
    }
  };
  void draining.then(resetIncompleteDrain, resetIncompleteDrain);
  return draining;
}

export async function stopMeetingAudioForward(meetingId: string) {
  const session = sessionsByMeetingId.get(meetingId);
  if (!session) {
    return (
      drainResultsByMeetingId.get(meetingId) ?? {
        archive: 0,
        complete: false,
        cursor: 0,
        reason: 'No audio forward session or drain result was found.',
      }
    );
  }
  if (session.archiveFilePath && !session.captureStopped) {
    return currentIncompleteResult(
      session,
      'Native audio capture is still active; stop the recording before draining.'
    );
  }
  const result = await drainSession(session);
  logger.info(
    `[audio-forward] stopped meeting=${meetingId} complete=${result.complete} cursor=${result.cursor} archive=${result.archive}`
  );
  return result;
}

/** Finalize forwarding after the underlying native recording and archive stop. */
export async function stopAudioForwardForRecording(recordingId: number) {
  const session = sessionsByRecordingId.get(recordingId);
  if (!session) {
    return null;
  }
  markAudioForwardCaptureStopped(recordingId);
  return drainSession(session);
}
