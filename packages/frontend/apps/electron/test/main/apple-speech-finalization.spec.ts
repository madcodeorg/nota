import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { beforeRecordingStateClear, fetchAiBackend } = vi.hoisted(() => ({
  beforeRecordingStateClear: vi.fn(),
  fetchAiBackend: vi.fn(),
}));

vi.mock('../../src/main/ai-backend', () => ({
  fetchAiBackend,
}));

vi.mock('../../src/main/recording/feature', () => ({
  getRawAudioBuffers: vi.fn(),
}));

vi.mock('../../src/main/recording/cleanup-hooks', () => ({
  beforeRecordingStateClear,
}));

vi.mock('../../src/main/recording/native-runtime', () => ({
  ensureNativeRecordingRuntimeDependencies: vi.fn(),
}));

import {
  appleSpeechHelperAudioCommand,
  AppleSpeechSessionRegistry,
  appleSpeechSystemFrameId,
  AppleSpeechTranscriptPostTracker,
  drainAppleSpeechAudioTail,
  drainAppleSpeechSessions,
  drainAppleSpeechTranscriptTail,
  pushAppleSpeechTranscriptEvent,
  registerAppleSpeechBridge,
} from '../../src/main/recording/apple-speech-bridge';

function response(status: number) {
  return new Response(JSON.stringify({ ok: status >= 200 && status < 300 }), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

beforeEach(() => {
  fetchAiBackend.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Apple Speech finalization', () => {
  test('sends stable frame IDs to the Apple Speech helper', () => {
    const frameId = appleSpeechSystemFrameId(4096, 8192);
    const command = JSON.parse(
      appleSpeechHelperAudioCommand({
        channels: 2,
        encoding: 'f32le',
        endMs: 20,
        frameId,
        pcmBase64: 'AAAAAA==',
        sampleRate: 48000,
        source: 'system',
        startMs: 10,
      })
    ) as Record<string, unknown>;

    expect(frameId).toBe('system:4096:8192');
    expect(command).toMatchObject({
      endMs: 20,
      frameId: 'system:4096:8192',
      pcmBase64: 'AAAAAA==',
      startMs: 10,
      type: 'audio',
    });
  });

  test('registers its all-session drain before recording state is cleared', () => {
    expect(beforeRecordingStateClear).toHaveBeenCalledOnce();
    expect(beforeRecordingStateClear).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  test('waits for a delayed final transcript emitted at source EOF before stop resolves', async () => {
    const tracker = new AppleSpeechTranscriptPostTracker();
    let closeSource: (() => void) | undefined;
    const sourceClosed = new Promise<void>(resolve => {
      closeSource = resolve;
    });
    let releasePost: (() => void) | undefined;
    const delayedPost = new Promise<void>(resolve => {
      releasePost = resolve;
    });

    let stopped = false;
    const stop = drainAppleSpeechTranscriptTail({
      flushTail: () => tracker.track(() => delayedPost, vi.fn()),
      posts: tracker,
      sourceClosed,
    }).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    closeSource?.();
    await Promise.resolve();
    expect(stopped).toBe(false);

    releasePost?.();
    await stop;
    expect(stopped).toBe(true);
  });

  test('drains every bounded raw-audio chunk before finalizing Apple Speech', async () => {
    const pump = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await drainAppleSpeechAudioTail(pump);

    expect(pump).toHaveBeenCalledTimes(3);
  });

  test('keeps transcript posts in callback order while draining', async () => {
    const tracker = new AppleSpeechTranscriptPostTracker();
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    tracker.track(async () => {
      order.push('first:start');
      await first;
      order.push('first:end');
    }, vi.fn());
    tracker.track(async () => {
      order.push('second');
    }, vi.fn());

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    releaseFirst?.();
    await tracker.drain();
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  test('propagates an exhausted transcript post and replays it on Retry Stop', async () => {
    vi.useFakeTimers();
    fetchAiBackend.mockRejectedValue(new TypeError('fetch failed'));
    const onError = vi.fn();
    const tracker = new AppleSpeechTranscriptPostTracker();
    tracker.track(
      () =>
        pushAppleSpeechTranscriptEvent('meeting-retry', {
          endMs: 1000,
          startMs: 0,
          text: 'Final words',
          type: 'final',
        }),
      onError
    );

    const firstDrain = tracker.drain();
    const rejected = expect(firstDrain).rejects.toThrow(
      'Failed to post Apple Speech transcript events.'
    );
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetchAiBackend).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledOnce();

    fetchAiBackend.mockResolvedValue(response(200));
    await expect(tracker.drain()).resolves.toBeUndefined();
    expect(fetchAiBackend).toHaveBeenCalledTimes(5);
  });

  test('keeps later transcript events behind a failed journal entry until retry', async () => {
    const tracker = new AppleSpeechTranscriptPostTracker();
    const order: string[] = [];
    const first = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => {
        order.push('first:failed');
        throw new Error('backend unavailable');
      })
      .mockImplementationOnce(async () => {
        order.push('first:replayed');
      });
    tracker.track(first, vi.fn());
    tracker.track(async () => {
      order.push('second');
    }, vi.fn());

    await expect(tracker.drain()).rejects.toThrow(
      'Failed to post Apple Speech transcript events.'
    );
    expect(order).toEqual(['first:failed']);

    await tracker.drain();
    expect(order).toEqual(['first:failed', 'first:replayed', 'second']);
  });

  test('retains a failed session stop so Retry Stop can finish it', async () => {
    const registry = new AppleSpeechSessionRegistry();
    const stop = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('transcript post failed'))
      .mockResolvedValueOnce();
    registry.set('meeting-retry', 'system', { stop });

    await expect(registry.stopMeeting('meeting-retry')).rejects.toThrow(
      'Failed to stop Apple Speech sessions.'
    );
    expect(stop).toHaveBeenCalledOnce();

    await expect(registry.stopMeeting('meeting-retry')).resolves.toBe(true);
    expect(stop).toHaveBeenCalledTimes(2);
    // Retain an idempotent successful-stop acknowledgement in case the
    // backend stop request failed and the renderer has to Retry Stop again.
    await expect(registry.stopMeeting('meeting-retry')).resolves.toBe(true);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  test('waits for every active Apple Speech session to finish', async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const first = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    let drained = false;
    const drain = drainAppleSpeechSessions([
      { stop: () => first },
      { stop: () => second },
    ]).then(() => {
      drained = true;
    });
    await Promise.resolve();

    releaseFirst?.();
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseSecond?.();
    await drain;
    expect(drained).toBe(true);
  });

  test('still drains remaining sessions when another stop fails', async () => {
    let releaseTail: (() => void) | undefined;
    const transcriptTail = new Promise<void>(resolve => {
      releaseTail = resolve;
    });
    let settled = false;
    const drain = drainAppleSpeechSessions([
      {
        stop: () => Promise.reject(new Error('native stop failed')),
      },
      { stop: () => transcriptTail },
    ]).finally(() => {
      settled = true;
    });
    const rejected = expect(drain).rejects.toThrow(
      'Failed to stop Apple Speech sessions.'
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    releaseTail?.();
    await rejected;
    expect(settled).toBe(true);
  });

  test('retries network and server failures before posting succeeds', async () => {
    vi.useFakeTimers();
    fetchAiBackend
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200));

    const posted = pushAppleSpeechTranscriptEvent('meeting-1', {
      endMs: 1000,
      startMs: 0,
      text: 'Final transcript',
      type: 'final',
    });
    await vi.runAllTimersAsync();

    await expect(posted).resolves.toEqual({ ok: true });
    expect(fetchAiBackend).toHaveBeenCalledTimes(3);
  });

  test('restores lost bridge state once before retrying a 503 event', async () => {
    fetchAiBackend.mockResolvedValue(response(200));
    await registerAppleSpeechBridge({
      available: true,
      reason: null,
      version: 'test-apple-speech',
    });
    fetchAiBackend.mockReset();
    fetchAiBackend
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    vi.useFakeTimers();

    const posted = pushAppleSpeechTranscriptEvent('meeting-1', {
      endMs: 1000,
      startMs: 0,
      text: 'Final transcript',
      type: 'final',
    });
    await vi.runAllTimersAsync();

    await expect(posted).resolves.toEqual({ ok: true });
    expect(fetchAiBackend.mock.calls.map(([path]) => path)).toEqual([
      '/v1/meetings/meeting-1/apple-speech/events',
      '/v1/stt/apple-speech/bridge',
      '/v1/meetings/meeting-1/apple-speech/events',
      '/v1/meetings/meeting-1/apple-speech/events',
    ]);
    const registrationBody = JSON.parse(
      String(fetchAiBackend.mock.calls[1]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(registrationBody).toEqual({
      available: true,
      reason: null,
      version: 'test-apple-speech',
    });
  });

  test('does not retry permanent client errors', async () => {
    fetchAiBackend.mockResolvedValue(response(409));

    await expect(
      pushAppleSpeechTranscriptEvent('meeting-1', {
        endMs: 1000,
        startMs: 0,
        text: 'Late transcript',
        type: 'final',
      })
    ).rejects.toThrow('AI backend returned HTTP 409');
    expect(fetchAiBackend).toHaveBeenCalledTimes(1);
  });

  test('bounds retries when the local backend stays unavailable', async () => {
    vi.useFakeTimers();
    fetchAiBackend.mockRejectedValue(new TypeError('fetch failed'));

    const posted = pushAppleSpeechTranscriptEvent('meeting-1', {
      endMs: 1000,
      startMs: 0,
      text: 'Final transcript',
      type: 'final',
    });
    const rejected = expect(posted).rejects.toThrow('fetch failed');
    await vi.runAllTimersAsync();

    await rejected;
    expect(fetchAiBackend).toHaveBeenCalledTimes(4);
  });

  test('times out every hung loopback attempt and eventually rejects', async () => {
    vi.useFakeTimers();
    fetchAiBackend.mockImplementation(() => new Promise(() => {}));

    const posted = pushAppleSpeechTranscriptEvent('meeting-1', {
      endMs: 1000,
      startMs: 0,
      text: 'Final transcript',
      type: 'final',
    });
    const rejected = expect(posted).rejects.toThrow(
      'AI backend request timed out after 3000ms.'
    );
    await vi.runAllTimersAsync();

    await rejected;
    expect(fetchAiBackend).toHaveBeenCalledTimes(4);
  });
});
