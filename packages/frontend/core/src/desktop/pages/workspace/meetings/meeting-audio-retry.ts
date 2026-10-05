const DEFAULT_AUDIO_RETRY_DELAYS_MS = [100, 200, 400, 800, 1600] as const;

export type MeetingAudioByteFrame = {
  endCursor: number;
  pcmBytes: Uint8Array;
  startCursor: number;
  streamKey: string;
};

export type MeetingAudioPostState = {
  acknowledgedCursor: number;
  retryFrame: MeetingAudioByteFrame | null;
  streamKey: string | null;
  tail: Promise<void>;
};

export function createMeetingAudioPostState(
  acknowledgedCursor = 0
): MeetingAudioPostState {
  return {
    acknowledgedCursor: Math.max(0, acknowledgedCursor),
    retryFrame: null,
    streamKey: null,
    tail: Promise.resolve(),
  };
}

async function postMeetingAudioBytesNow(input: {
  byteAlignment: number;
  chunkBytes: number;
  onPostError?: (error: unknown) => void;
  pcmBytes: Uint8Array;
  postFrame: (frame: MeetingAudioByteFrame) => Promise<void>;
  startCursor: number;
  state: MeetingAudioPostState;
  streamKey: string;
}) {
  const alignment = Math.max(1, Math.floor(input.byteAlignment));
  const alignedLength =
    Math.floor(input.pcmBytes.byteLength / alignment) * alignment;
  const chunkBytes = Math.max(
    alignment,
    Math.floor(input.chunkBytes / alignment) * alignment
  );
  const inputStartCursor = Math.max(0, input.startCursor);
  const inputEndCursor = inputStartCursor + alignedLength;

  if (input.state.streamKey === null) {
    input.state.streamKey = input.streamKey;
    input.state.acknowledgedCursor = Math.max(
      input.state.acknowledgedCursor,
      inputStartCursor
    );
  } else if (input.state.streamKey !== input.streamKey) {
    throw new Error(
      'Cannot reuse meeting audio retry state for a different recording stream.'
    );
  }

  if (
    inputStartCursor > input.state.acknowledgedCursor &&
    input.state.retryFrame
  ) {
    throw new Error(
      'Meeting audio retry state has an unacknowledged frame before the supplied cursor.'
    );
  }
  input.state.acknowledgedCursor = Math.max(
    input.state.acknowledgedCursor,
    inputStartCursor
  );

  const retryFrame = input.state.retryFrame;
  if (retryFrame) {
    try {
      await input.postFrame(retryFrame);
    } catch (error) {
      input.onPostError?.(error);
      return input.state.acknowledgedCursor;
    }
    input.state.acknowledgedCursor = retryFrame.endCursor;
    if (input.state.retryFrame === retryFrame) {
      input.state.retryFrame = null;
    }
  }

  let offset = Math.max(0, input.state.acknowledgedCursor - inputStartCursor);
  if (input.state.acknowledgedCursor >= inputEndCursor) {
    return input.state.acknowledgedCursor;
  }

  for (; offset < alignedLength; offset += chunkBytes) {
    const nextOffset = Math.min(offset + chunkBytes, alignedLength);
    const frame: MeetingAudioByteFrame = {
      endCursor: inputStartCursor + nextOffset,
      // Own this exact range until acknowledgement. The raw archive buffer
      // supplied by a later poll may contain more bytes.
      pcmBytes: input.pcmBytes.slice(offset, nextOffset),
      startCursor: inputStartCursor + offset,
      streamKey: input.streamKey,
    };
    input.state.retryFrame = frame;
    try {
      await input.postFrame(frame);
    } catch (error) {
      input.onPostError?.(error);
      return input.state.acknowledgedCursor;
    }
    input.state.acknowledgedCursor = frame.endCursor;
    if (input.state.retryFrame === frame) {
      input.state.retryFrame = null;
    }
  }

  return input.state.acknowledgedCursor;
}

export function postMeetingAudioBytes(input: {
  byteAlignment: number;
  chunkBytes: number;
  onPostError?: (error: unknown) => void;
  pcmBytes: Uint8Array;
  postFrame: (frame: MeetingAudioByteFrame) => Promise<void>;
  startCursor: number;
  state: MeetingAudioPostState;
  streamKey: string;
}) {
  // Polling and Stop can overlap while native capture is winding down. Queue
  // them behind one cursor so the later call skips bytes already acknowledged
  // by the earlier one instead of posting them twice.
  const posting = input.state.tail.then(() => postMeetingAudioBytesNow(input));
  input.state.tail = posting.then(
    () => undefined,
    () => undefined
  );
  return posting;
}

export async function drainMeetingAudioArchive(input: {
  hasPendingRetry?: () => boolean;
  onProgress?: () => void;
  post: (pcmBytes: Uint8Array, startCursor: number) => Promise<number>;
  read: (
    cursor: number
  ) => Promise<{ nextCursor: number; pcmBytes: Uint8Array }>;
  requireComplete?: boolean;
  startCursor: number;
}) {
  let cursor = Math.max(0, input.startCursor);
  while (true) {
    const readCursor = cursor;
    const { nextCursor: archiveCursor, pcmBytes } =
      await input.read(readCursor);
    const nextCursor = await input.post(pcmBytes, readCursor);
    if (nextCursor > readCursor) {
      input.onProgress?.();
    }
    if (nextCursor < archiveCursor) {
      if (input.requireComplete) {
        throw new Error(
          `System audio delivery stopped at byte ${nextCursor} of at least ${archiveCursor}.`
        );
      }
      return nextCursor;
    }
    if (
      !pcmBytes.byteLength ||
      archiveCursor <= readCursor ||
      nextCursor <= readCursor
    ) {
      if (input.requireComplete && input.hasPendingRetry?.()) {
        throw new Error(
          `System audio retry is still waiting at byte ${nextCursor}.`
        );
      }
      return nextCursor;
    }
    cursor = nextCursor;
  }
}

export function takeMeetingAudioSamples(
  chunks: Float32Array[],
  maxSamples: number
) {
  const taken: Float32Array[] = [];
  let sampleCount = 0;
  const limit = Math.max(0, Math.floor(maxSamples));

  while (chunks.length && sampleCount < limit) {
    const chunk = chunks.shift();
    if (!chunk) break;
    const remaining = limit - sampleCount;
    if (chunk.length <= remaining) {
      taken.push(chunk);
      sampleCount += chunk.length;
      continue;
    }

    taken.push(chunk.slice(0, remaining));
    chunks.unshift(chunk.slice(remaining));
    sampleCount += remaining;
  }

  return { chunks: taken, sampleCount };
}

export async function retryMeetingAudioOperation<T>(
  operation: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    wait?: (delayMs: number) => Promise<void>;
  } = {}
) {
  const delays = options.delaysMs ?? DEFAULT_AUDIO_RETRY_DELAYS_MS;
  const wait =
    options.wait ??
    ((delayMs: number) =>
      new Promise<void>(resolve => globalThis.setTimeout(resolve, delayMs)));
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = delays[attempt];
      if (delay === undefined) {
        break;
      }
      await wait(delay);
    }
  }

  throw lastError;
}
