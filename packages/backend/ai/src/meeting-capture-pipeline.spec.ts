import { afterEach, describe, expect, test, vi } from 'vitest';

import type { MeetingNormalizedAudioFrame } from './meeting-audio-spool';
import {
  type CaptureTranscript,
  createMeetingCapturePipeline,
  type MeetingCaptureMetrics,
  type MeetingSpeechDetector,
  type MeetingUtteranceDecoder,
} from './meeting-capture-pipeline';

afterEach(() => vi.restoreAllMocks());

function frame(
  startMs: number,
  durationMs: number,
  value = 0.05,
  source: 'mic' | 'system' = 'mic'
): MeetingNormalizedAudioFrame {
  const pcm16 = Int16Array.from(
    { length: durationMs * 16 },
    (_, i) => value * 32767 * Math.cos((2 * Math.PI * 1000 * i) / 16000)
  );
  return {
    durationMs,
    endMs: startMs + durationMs,
    level: Math.abs(value),
    pcm16,
    sampleRate: 16000,
    source,
    speech: Math.abs(value) >= 0.008,
    startMs,
  };
}

function fixture(streaming = true, vad: MeetingSpeechDetector | null = null) {
  const fed: Int16Array[] = [];
  const events: CaptureTranscript[] = [];
  const metrics: MeetingCaptureMetrics[] = [];
  let samples = 0;
  const decoder: MeetingUtteranceDecoder = {
    supportsPartials: streaming,
    pushPcm16: vi.fn(pcm => {
      fed.push(pcm);
      samples += pcm.length;
    }),
    partial: vi.fn(async () => `heard ${samples}`),
    finish: vi.fn(async () => {
      samples = 0;
      return { language: 'en', text: 'a complete phrase' };
    }),
  };
  const onEmptyFinal = vi.fn();
  const pipeline = createMeetingCapturePipeline({
    decoder,
    onEmptyFinal,
    onMetrics: m => metrics.push(m),
    onTranscript: e => {
      events.push(e);
    },
    vad,
  });
  return { decoder, events, fed, metrics, onEmptyFinal, pipeline };
}

describe('shared meeting capture pipeline', () => {
  test('delivers mono partials with one packet of lookahead and drains an exact stop tail', async () => {
    const f = fixture();
    await f.pipeline.push(frame(500, 100));
    expect(f.events).toEqual([]);
    await f.pipeline.push(frame(600, 125));
    expect(f.events[0]).toMatchObject({
      startMs: 500,
      endMs: 600,
      type: 'partial',
    });
    await f.pipeline.stop();
    expect(f.fed.reduce((n, pcm) => n + pcm.length, 0)).toBe(225 * 16);
    expect(f.fed.at(-1)?.length).toBe(25 * 16);
    expect(f.events.at(-1)).toMatchObject({
      startMs: 500,
      endMs: 725,
      type: 'final',
      language: 'en',
    });
  });

  test('mixes staggered sources on their capture timestamps', async () => {
    const f = fixture();
    await f.pipeline.push(frame(500, 100, 0.1, 'system'));
    await f.pipeline.push(frame(600, 100, -0.1, 'mic'));
    expect(f.fed).toHaveLength(1);
    expect(f.fed[0][0]).toBeGreaterThan(0);
    await f.pipeline.push(frame(600, 100, 0.1, 'system'));
    await f.pipeline.stop();
    // The mic starts in the second time slice, never over the first one.
    expect(f.fed).toHaveLength(2);
    expect(Math.abs(f.fed[1][0])).toBeLessThan(1000);
    expect(f.metrics.at(-1)?.lateAudioMs).toBe(0);
  });

  test('bounds source waiting and reports late audio instead of shifting it into future speech', async () => {
    const f = fixture();
    await f.pipeline.push(frame(0, 200));
    await f.pipeline.push(frame(0, 100, 0.1, 'system'));
    expect(f.metrics.at(-1)?.lateAudioMs).toBe(100);
    await f.pipeline.push(frame(200, 500));
    // A stalled system source only holds the last 200 ms of microphone audio.
    expect(f.events.at(-1)?.endMs).toBe(500);
    await f.pipeline.stop();
    expect(f.events.at(-1)?.endMs).toBe(700);
    expect(f.fed.reduce((n, pcm) => n + pcm.length, 0)).toBe(700 * 16);
  });

  test('keeps every sample of a large delayed frame and continues native decoding', async () => {
    const f = fixture();
    await f.pipeline.push(frame(0, 6000));
    await f.pipeline.stop();
    expect(f.decoder.partial).toHaveBeenCalledTimes(60);
    expect(f.fed.reduce((n, pcm) => n + pcm.length, 0)).toBe(6000 * 16);
    expect(f.metrics.at(-1)?.lateAudioMs).toBe(0);
  });

  test('retains phrase context for offline Parakeet/Whisper and emits only phrase finals', async () => {
    const f = fixture(false);
    await f.pipeline.push(frame(0, 2000));
    expect(f.decoder.finish).not.toHaveBeenCalled();
    expect(f.decoder.partial).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
    await f.pipeline.push(frame(2000, 500, 0));
    expect(f.decoder.finish).toHaveBeenCalledOnce();
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      type: 'final',
      startMs: 0,
      endMs: 2400,
    });
    await f.pipeline.stop();
    expect(f.decoder.finish).toHaveBeenCalledOnce();
  });

  test('commits streaming text after 500 ms of silence instead of two seconds', async () => {
    const f = fixture();
    await f.pipeline.push(frame(0, 200));
    await f.pipeline.push(frame(200, 500, 0));
    expect(f.decoder.finish).not.toHaveBeenCalled();
    await f.pipeline.push(frame(700, 100, 0));
    expect(f.events.at(-1)).toMatchObject({ type: 'final', endMs: 700 });
  });

  test('boosts quiet system speech before VAD and caps loud mixed peaks', async () => {
    const seen: Int16Array[] = [];
    const f = fixture(true, {
      push: async pcm => {
        seen.push(pcm);
        return Math.max(...pcm.map(Math.abs)) > 130 ? 0.8 : 0;
      },
    });
    await f.pipeline.push(frame(0, 200, 0.002, 'system'));
    expect(f.events[0]).toMatchObject({ source: 'system', type: 'partial' });
    expect(seen[0][0]).toBeGreaterThan(130);
    await f.pipeline.push(frame(200, 100, 0.9, 'system'));
    await f.pipeline.push(frame(200, 100, 0.9, 'mic'));
    await f.pipeline.stop();
    expect(
      Math.max(...f.fed.flatMap(pcm => [...pcm].map(Math.abs)))
    ).toBeLessThanOrEqual(Math.ceil(32768 * 0.95));
  });

  test('does not carry quiet-speech gain into background below the gain floor', async () => {
    const seen: Int16Array[] = [];
    const f = fixture(true, {
      push: async pcm => {
        seen.push(pcm);
        return 0.8;
      },
    });
    await f.pipeline.push(frame(0, 500, 0.002, 'system'));
    const background = frame(500, 100, 0.0003, 'system');
    await f.pipeline.push(background);
    await f.pipeline.stop();
    expect(seen[0][0]).toBeGreaterThan(130);
    expect(
      Math.max(
        ...seen[5].map((sample, i) => Math.abs(sample - background.pcm16[i]))
      )
    ).toBeLessThanOrEqual(1);
  });

  test('reduces accumulated gain immediately when loud speech or a transient arrives', async () => {
    const seen: Int16Array[] = [];
    const f = fixture(true, {
      push: async pcm => {
        seen.push(pcm);
        return 0.8;
      },
    });
    await f.pipeline.push(frame(0, 2000, 0.002, 'system'));
    await f.pipeline.push(frame(2000, 100, 0.9, 'system'));
    const transient = frame(2100, 100, 0.002, 'system');
    transient.pcm16[800] = 32767;
    await f.pipeline.push(transient);
    await f.pipeline.stop();
    expect(Math.max(...seen[20].map(Math.abs))).toBeLessThanOrEqual(14746);
    expect(Math.max(...seen[21].map(Math.abs))).toBeLessThanOrEqual(29491);
  });

  test('boosts quiet system speech independently of a loud microphone', async () => {
    const seen: Int16Array[] = [];
    const f = fixture(true, {
      push: async pcm => {
        seen.push(pcm);
        return 0.8;
      },
    });
    for (let start = 0; start < 300; start += 100) {
      await f.pipeline.push(frame(start, 100, 0.8, 'mic'));
      await f.pipeline.push(frame(start, 100, 0.002, 'system'));
    }
    await f.pipeline.push(frame(300, 100, 0.002, 'system'));
    await f.pipeline.stop();
    expect(seen[3][800]).toBeGreaterThan(32767 * 0.002 * 6);
  });

  test('preserves accepted source PCM while changing recognition volume', async () => {
    const f = fixture();
    const input = frame(0, 1000);
    const original = input.pcm16.slice();
    await f.pipeline.push(input);
    await f.pipeline.stop();
    expect(f.events.at(-1)?.endMs).toBe(1000);
    expect(f.fed[0][0]).toBeGreaterThan(original[0]);
    expect(input.pcm16).toEqual(original);
  });

  test('keeps recognition PCM consistent across incoming packet boundaries', async () => {
    const whole = fixture();
    const split = fixture();
    await whole.pipeline.push(frame(0, 225));
    await split.pipeline.push(frame(0, 125));
    await split.pipeline.push(frame(125, 100));
    await whole.pipeline.stop();
    await split.pipeline.stop();
    expect(split.fed).toEqual(whole.fed);
    expect(split.events.at(-1)?.endMs).toBe(225);
  });

  test('preserves a restart gap without allocating silence for the entire gap', async () => {
    const f = fixture();
    await f.pipeline.push(frame(0, 200));
    await f.pipeline.push(frame(60_000, 200));
    await f.pipeline.stop();
    const finals = f.events.filter(e => e.type === 'final');
    expect(finals).toHaveLength(2);
    expect(finals[0].endMs).toBe(700);
    expect(finals[1].startMs).toBeGreaterThanOrEqual(59_400);
    expect(finals[1].endMs).toBe(60_200);
    expect(f.metrics.at(-1)!.audioTimeMs).toBeLessThan(1000);
  });

  test('includes offline final decoding in the realtime factor', async () => {
    let wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const f = fixture(false);
    f.decoder.finish = vi.fn(async () => {
      wall += 250;
      return { language: null, text: 'final' };
    });
    await f.pipeline.push(frame(0, 100));
    await f.pipeline.stop();
    expect(f.metrics.at(-1)).toMatchObject({
      lastFinalDecodeMs: 250,
      decodeRealtimeFactor: 2.5,
    });
  });

  test('removes a stale partial when final decoding is empty', async () => {
    const f = fixture();
    f.decoder.finish = vi.fn(async () => ({ language: null, text: '' }));
    await f.pipeline.push(frame(0, 200));
    await f.pipeline.stop();
    expect(f.onEmptyFinal).toHaveBeenCalledWith(f.events[0].id);
    expect(f.events.every(e => e.type === 'partial')).toBe(true);
  });

  test('reports a failed VAD as an energy fallback', async () => {
    const f = fixture(true, { failed: true, push: async () => null });
    await f.pipeline.push(frame(0, 200));
    expect(f.metrics.at(-1)?.vadMode).toBe('energy');
  });

  test('keeps healthy VAD status when a short stop tail cannot fill its window', async () => {
    const f = fixture(true, { failed: false, push: async () => null });
    await f.pipeline.push(frame(0, 25));
    await f.pipeline.stop();
    expect(f.metrics.at(-1)?.vadMode).toBe('silero');
  });
});
