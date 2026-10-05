import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), on: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('../../src/main/ai-backend', () => ({
  fetchAiBackend: (path: string, init?: RequestInit) =>
    globalThis.fetch(`http://127.0.0.1:3010${path}`, init),
}));

vi.mock('../../src/main/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  forwardAudioSamples,
  startMeetingAudioForward,
  stopMeetingAudioForward,
} from '../../src/main/recording/audio-forward';
import { RecordingStateMachine } from '../../src/main/recording/state-machine';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('recording lifecycle', () => {
  it('treats recording ID 0 as a valid recording', () => {
    const stateMachine = new RecordingStateMachine();

    const started = stateMachine.dispatch({ type: 'START_RECORDING' });
    expect(started).toMatchObject({ id: 0, status: 'recording' });

    const stopped = stateMachine.dispatch({ type: 'STOP_RECORDING', id: 0 });
    expect(stopped).toMatchObject({ id: 0, status: 'stopped' });
  });

  it('can start a second meeting after the finalized capture is released', () => {
    const stateMachine = new RecordingStateMachine();

    const first = stateMachine.dispatch({ type: 'START_RECORDING' });
    expect(first).toMatchObject({ id: 0, status: 'recording' });
    stateMachine.dispatch({ type: 'STOP_RECORDING', id: first!.id });
    stateMachine.dispatch({ type: 'REMOVE_RECORDING', id: first!.id });

    const second = stateMachine.dispatch({ type: 'START_RECORDING' });
    expect(second).toMatchObject({ id: 1, status: 'recording' });
  });

  it('retains the capture failure reason in recording status', () => {
    const stateMachine = new RecordingStateMachine();
    const started = stateMachine.dispatch({ type: 'START_RECORDING' });
    const failed = stateMachine.dispatch({
      type: 'CREATE_BLOCK_FAILED',
      id: started?.id ?? -1,
      error: new Error('disk full'),
    });

    expect(failed).toMatchObject({
      error: 'disk full',
      status: 'create-block-failed',
    });
  });

  it('waits for an in-flight audio post before stopping the forwarder', async () => {
    vi.useFakeTimers();
    let resolvePost: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          resolvePost = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      channels: 1,
      meetingId: 'meeting-zero',
      recordingId: 0,
      sampleRate: 16_000,
    });
    forwardAudioSamples(0, new Float32Array([0.1, 0.2, 0.3]));

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledOnce();

    let stopped = false;
    const stopPromise = stopMeetingAudioForward('meeting-zero').then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    resolvePost?.({ ok: true } as Response);
    await stopPromise;
    expect(stopped).toBe(true);
  });
});
