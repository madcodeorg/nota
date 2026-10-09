import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';

import type {
  MeetingAudioSource,
  MeetingNormalizedAudioFrame,
} from './meeting-audio-spool';

const SAMPLE_RATE = 16_000;
const WINDOW_MS = 100;
const WINDOW_SAMPLES = SAMPLE_RATE / 10;
// System audio comes through a separate capture path and can trail the mic by
// a few hundred ms. Waiting longer keeps it in the live mix instead of
// dropping it as late; the wait only applies while one source is behind.
const SOURCE_WAIT_MS = 500;
const SOURCE_WAIT_SAMPLES = (SAMPLE_RATE * SOURCE_WAIT_MS) / 1000;
const PREFIX_MS = 600;
// Long speech is cut at the first short pause after the soft limit, so words
// are not split mid-sentence. The hard limit only applies to non-stop speech.
const SOFT_UTTERANCE_MS = 10_000;
const HARD_UTTERANCE_MS = 20_000;
const SOFT_CUT_SILENCE_MS = 150;
const ENERGY_THRESHOLD = 0.006;
const GAIN_FLOOR = 0.0008;
const TARGET_SPEECH_RMS = 0.06;
// First-order 80 Hz high-pass for the microphone, as in Meetily's mic chain:
// removes rumble, desk thumps and mains hum before gain and VAD.
const MIC_HIGH_PASS_ALPHA = 1 / (1 + 2 * Math.PI * 80 * (1 / SAMPLE_RATE));

export interface MeetingUtteranceDecoder {
  readonly executionProvider?: string;
  readonly supportsPartials: boolean;
  pushPcm16(pcm: Int16Array): void;
  partial(): Promise<string | null>;
  finish(): Promise<{ language: string | null; text: string }>;
}

export interface MeetingSpeechDetector {
  readonly failed?: boolean;
  push(pcm: Int16Array): Promise<number | null>;
}

export interface CaptureTranscript {
  endMs: number;
  id: string;
  language?: string;
  source: MeetingAudioSource;
  startMs: number;
  text: string;
  type: 'final' | 'partial';
}

export interface MeetingCaptureMetrics {
  audioTimeMs: number;
  decodeRealtimeFactor: number;
  lastDecodeMs: number;
  lastFinalDecodeMs: number;
  lateAudioMs: number;
  sourceWaitMs: number;
  vadMode: 'silero' | 'energy';
  windowMs: number;
}

export function initialMixedCaptureSpeechGate(
  rawRms: number,
  vadSpeech: boolean
) {
  return {
    noiseFloorRms: Math.min(rawRms, ENERGY_THRESHOLD / 1.4),
    speech: vadSpeech || rawRms >= ENERGY_THRESHOLD,
  };
}

export function shouldFinalizeMixedCaptureUtterance(input: {
  lastSpeechMs: number;
  silenceFinalizeMs?: number;
  utteranceStartMs: number;
  windowEndMs: number;
}) {
  // Keep phrase context for offline models. Do not turn every capture packet
  // into an ASR request or repeatedly decode a growing Whisper buffer.
  const length = input.windowEndMs - input.utteranceStartMs;
  const silence = input.windowEndMs - input.lastSpeechMs;
  return (
    length >= HARD_UTTERANCE_MS ||
    silence >= (input.silenceFinalizeMs ?? 500) ||
    (length >= SOFT_UTTERANCE_MS && silence >= SOFT_CUT_SILENCE_MS)
  );
}

function rms(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

interface AudioSpan {
  pcm: Int16Array;
  start: number;
}

interface MixedWindow {
  endMs: number;
  micRms: number;
  pcm: Int16Array;
  rawRms: number;
  startMs: number;
  systemRms: number;
}

// Timestamped spans keep a late or interrupted source in its original time
// slice. Gaps are sparse; a renderer restart never allocates minutes of zeros.
function createMixer(onLateAudio: (samples: number) => void) {
  const sources: MeetingAudioSource[] = ['mic', 'system'];
  const spans: Record<MeetingAudioSource, AudioSpan[]> = {
    mic: [],
    system: [],
  };
  const ends: Record<MeetingAudioSource, number | null> = {
    mic: null,
    system: null,
  };
  // Speech loudness per source. Learned only from speech-level audio, held
  // through pauses, and released slowly, so gain stays steady across a phrase
  // instead of pumping background noise up between words.
  const levels: Record<MeetingAudioSource, number | null> = {
    mic: null,
    system: null,
  };
  const applied: Record<MeetingAudioSource, number | null> = {
    mic: null,
    system: null,
  };
  const highPass = { input: 0, output: 0 };
  let cursor: number | null = null;
  let consumed = false;

  function drain(source: MeetingAudioSource, start: number, count: number) {
    const out = new Float32Array(count);
    const queue = spans[source];
    while (queue.length) {
      const head = queue[0];
      const end = head.start + head.pcm.length;
      if (head.start >= start + count) break;
      const from = Math.max(start, head.start);
      const to = Math.min(start + count, end);
      for (let pos = from; pos < to; pos++) {
        const sample = head.pcm[pos - head.start];
        out[pos - start] = sample < 0 ? sample / 32768 : sample / 32767;
      }
      if (end > start + count) {
        head.pcm = head.pcm.subarray(start + count - head.start);
        head.start = start + count;
        break;
      }
      queue.shift();
    }
    return out;
  }

  function filterMic(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      highPass.output =
        MIC_HIGH_PASS_ALPHA * (highPass.output + x - highPass.input);
      highPass.input = x;
      samples[i] = highPass.output;
    }
  }

  // Returns a [start, end] gain ramp for this window. Sources are normalized
  // separately so loud microphone speech cannot set quiet system gain.
  function gainFor(
    source: MeetingAudioSource,
    samples: Float32Array,
    level: number,
    learn: boolean
  ): [number, number] {
    // Never boost digital silence or a signal below the fixed gain floor.
    if (level <= GAIN_FLOOR) {
      applied[source] = 1;
      return [1, 1];
    }
    const known = levels[source];
    if (learn || known === null) {
      // Fast attack for louder speech, slow (~5 s) release for quieter.
      levels[source] =
        known === null
          ? level
          : known + (level - known) * (level > known ? 0.5 : 0.02);
    }
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    const target = Math.max(
      0.5,
      Math.min(12, TARGET_SPEECH_RMS / (levels[source] ?? level), 0.9 / peak)
    );
    // Drop gain at once on louder input; only increases are ramped.
    const from = Math.min(applied[source] ?? target, target);
    applied[source] = target;
    return [from, target];
  }

  return {
    add(frame: MeetingNormalizedAudioFrame) {
      if (!frame.pcm16.length) return;
      let start = Math.round((frame.startMs * SAMPLE_RATE) / 1000);
      const previousEnd = ends[frame.source];
      // Frame timestamps are rounded to milliseconds. Snap sub-millisecond
      // rounding differences without changing real gaps or source offsets.
      if (previousEnd !== null && Math.abs(start - previousEnd) <= 16) {
        start = previousEnd;
      }
      const end = start + frame.pcm16.length;
      ends[frame.source] = Math.max(previousEnd ?? end, end);
      if (!consumed) cursor = Math.min(cursor ?? start, start);
      const trim = Math.min(
        frame.pcm16.length,
        Math.max(0, (cursor ?? start) - start)
      );
      if (trim) onLateAudio(trim);
      if (trim < frame.pcm16.length) {
        spans[frame.source].push({
          pcm: frame.pcm16.subarray(trim),
          start: start + trim,
        });
      }
    },
    next(flush = false, learn = true): MixedWindow | null {
      if (cursor === null) return null;
      const seenEnds = sources.flatMap(source => {
        const end = ends[source];
        return end === null ? [] : [end];
      });
      const latest = Math.max(...seenEnds);
      // One packet of initial lookahead lets the other source join. With both
      // sources present, wait at most SOURCE_WAIT_MS of audio for a stalled source.
      const watermark = flush
        ? latest
        : seenEnds.length === 1
          ? latest - WINDOW_SAMPLES
          : Math.max(Math.min(...seenEnds), latest - SOURCE_WAIT_SAMPLES);
      if (
        watermark <= cursor ||
        (!flush && watermark - cursor < WINDOW_SAMPLES)
      )
        return null;
      const nextStart = Math.min(
        ...sources.flatMap(source =>
          spans[source][0] ? [spans[source][0].start] : []
        )
      );
      // Retain enough silence to endpoint a phrase, then skip an actual long
      // capture gap. Timestamps still reflect the gap on the meeting timeline.
      if (Number.isFinite(nextStart) && nextStart - cursor > SAMPLE_RATE * 2) {
        cursor = nextStart - SAMPLE_RATE / 2;
        levels.mic = levels.system = null;
        applied.mic = applied.system = null;
        highPass.input = highPass.output = 0;
      }
      const count = Math.min(WINDOW_SAMPLES, watermark - cursor);
      if (count <= 0) return null;
      const startMs = (cursor * 1000) / SAMPLE_RATE;
      const mic = drain('mic', cursor, count);
      const system = drain('system', cursor, count);
      filterMic(mic);
      const micRms = rms(mic);
      const systemRms = rms(system);
      const [micFrom, micTo] = gainFor('mic', mic, micRms, learn);
      const [systemFrom, systemTo] = gainFor(
        'system',
        system,
        systemRms,
        learn
      );
      let rawEnergy = 0;
      let peak = 0;
      const mixed = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const raw = mic[i] + system[i];
        rawEnergy += raw * raw;
        const t = count > 1 ? i / (count - 1) : 1;
        mixed[i] =
          mic[i] * (micFrom + (micTo - micFrom) * t) +
          system[i] * (systemFrom + (systemTo - systemFrom) * t);
        peak = Math.max(peak, Math.abs(mixed[i]));
      }
      const limit = peak > 0.95 ? 0.95 / peak : 1;
      const pcm = new Int16Array(count);
      for (let i = 0; i < count; i++) {
        const sample = mixed[i] * limit;
        pcm[i] = sample * (sample < 0 ? 32768 : 32767);
      }
      cursor += count;
      consumed = true;
      return {
        endMs: (cursor * 1000) / SAMPLE_RATE,
        micRms,
        pcm,
        rawRms: Math.sqrt(rawEnergy / count),
        startMs,
        systemRms,
      };
    },
  };
}

// The session supplies an ordered frame queue. This engine owns only mixing,
// speech detection and the selected decoder; it has no model or storage loader.
export function createMeetingCapturePipeline(input: {
  decoder: MeetingUtteranceDecoder;
  onEmptyFinal: (id: string) => void;
  onMetrics: (metrics: MeetingCaptureMetrics) => void;
  onTranscript: (segment: CaptureTranscript) => Promise<void> | void;
  vad: MeetingSpeechDetector | null;
}) {
  const metrics: MeetingCaptureMetrics = {
    audioTimeMs: 0,
    decodeRealtimeFactor: 0,
    lastDecodeMs: 0,
    lastFinalDecodeMs: 0,
    lateAudioMs: 0,
    sourceWaitMs: SOURCE_WAIT_MS,
    vadMode: input.vad ? 'silero' : 'energy',
    windowMs: WINDOW_MS,
  };
  const mixer = createMixer(samples => {
    metrics.lateAudioMs += (samples * 1000) / SAMPLE_RATE;
  });
  let ring: MixedWindow[] = [];
  let active = false;
  let id = '';
  let startMs = 0;
  let lastSpeechMs = 0;
  let lastEndMs = 0;
  let lastPartial = '';
  let vadSpeech = false;
  let vadKnown = false;
  let micEnergy = 0;
  let systemEnergy = 0;
  let decodeTotalMs = 0;
  let windowsSinceYield = 0;

  const source = (): MeetingAudioSource =>
    systemEnergy > micEnergy * 1.15 ? 'system' : 'mic';
  const report = () => {
    metrics.decodeRealtimeFactor =
      Math.round((decodeTotalMs / Math.max(1, metrics.audioTimeMs)) * 100) /
      100;
    input.onMetrics({ ...metrics });
  };

  function detectSpeech(probability: number | null, level: number) {
    if (probability === null) {
      // A healthy detector can be waiting for the rest of its 512-sample
      // window at stop. Only report degradation when it actually failed.
      if (!input.vad || input.vad.failed !== false) metrics.vadMode = 'energy';
      return vadKnown && input.vad?.failed === false
        ? vadSpeech
        : level >= ENERGY_THRESHOLD;
    }
    // A healthy Silero decides alone. Letting energy override it kept steady
    // fans, hum or music "speaking" forever and forced 15 s cuts.
    vadSpeech = probability >= (vadSpeech ? 0.35 : 0.5);
    vadKnown = true;
    return vadSpeech;
  }

  async function finish(endMs: number) {
    if (!active) return;
    const decodeStart = performance.now();
    let result: { language: string | null; text: string };
    try {
      result = await input.decoder.finish();
    } finally {
      // A failed decode must not glue the next phrase onto this one.
      metrics.lastFinalDecodeMs = performance.now() - decodeStart;
      decodeTotalMs += metrics.lastFinalDecodeMs;
      active = false;
      ring = [];
      lastPartial = '';
      micEnergy = systemEnergy = 0;
    }
    const text = result.text.trim();
    const phraseSource = source();
    if (text) {
      await input.onTranscript({
        endMs,
        id,
        ...(result.language ? { language: result.language } : {}),
        source: phraseSource,
        startMs,
        text,
        type: 'final',
      });
    } else {
      input.onEmptyFinal(id);
    }
    report();
  }

  function feed(window: MixedWindow) {
    input.decoder.pushPcm16(window.pcm);
    const duration = window.endMs - window.startMs;
    micEnergy += window.micRms ** 2 * duration;
    systemEnergy += window.systemRms ** 2 * duration;
  }

  async function handle(window: MixedWindow) {
    if (window.startMs > lastEndMs) {
      if (active) {
        await finish(
          Math.min(
            window.startMs,
            lastSpeechMs + (input.decoder.supportsPartials ? 500 : 400)
          )
        );
      }
      ring = [];
    }
    lastEndMs = window.endMs;
    metrics.audioTimeMs += window.endMs - window.startMs;
    const decodeStart = performance.now();
    const probability = input.vad ? await input.vad.push(window.pcm) : null;
    const speech = detectSpeech(probability, window.rawRms);
    if (speech) lastSpeechMs = window.endMs;
    if (!active) {
      ring.push(window);
      ring = ring.filter(previous => previous.endMs > window.endMs - PREFIX_MS);
      if (!speech) {
        report();
        return;
      }
      active = true;
      id = randomUUID();
      startMs = ring[0].startMs;
      for (const buffered of ring) feed(buffered);
      ring = [];
    } else {
      feed(window);
    }
    // Native streaming decoders must continue consuming encoder chunks during
    // backlog. Skipping partial() also skipped the actual Nemotron decoding.
    if (input.decoder.supportsPartials) {
      const text = await input.decoder.partial();
      if (text && text !== lastPartial) {
        lastPartial = text;
        await input.onTranscript({
          endMs: window.endMs,
          id,
          source: source(),
          startMs,
          text,
          type: 'partial',
        });
      }
    }
    metrics.lastDecodeMs = performance.now() - decodeStart;
    decodeTotalMs += metrics.lastDecodeMs;
    if (
      shouldFinalizeMixedCaptureUtterance({
        lastSpeechMs,
        silenceFinalizeMs: input.decoder.supportsPartials ? 500 : 400,
        utteranceStartMs: startMs,
        windowEndMs: window.endMs,
      })
    ) {
      await finish(window.endMs);
    }
    report();
  }

  async function drain(flush: boolean) {
    // Do not learn source loudness from audio Silero just called non-speech.
    const learn = () => !(vadKnown && !vadSpeech);
    for (
      let window = mixer.next(flush, learn());
      window;
      window = mixer.next(flush, learn())
    ) {
      await handle(window);
      // Give disk acceptance, HTTP and transcript delivery a turn while a
      // delayed source or a large recovered frame is being caught up.
      if (++windowsSinceYield >= 10) {
        windowsSinceYield = 0;
        await setImmediate();
      }
    }
  }

  report();
  return {
    async push(frame: MeetingNormalizedAudioFrame) {
      mixer.add(frame);
      await drain(false);
      report();
    },
    async stop() {
      await drain(true);
      await finish(lastSpeechMs || lastEndMs);
      report();
    },
  };
}
