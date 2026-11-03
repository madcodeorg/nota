import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type { MeetingUtteranceDecoder } from './meeting-capture-pipeline';

export type NativeAsrRuntime = 'whisper.cpp';
type Recognition = {
  text: string;
  language: string | null;
  noSpeechProb: number;
  avgLogprob: number;
};
const workers = new Map<string, NativeAsrWorker>();
const IDLE_MS = 60_000;
const LANGUAGE_VOTE_MIN_SAMPLES = 3 * 16000;
const LANGUAGE_LOCK_VOTES = 2;
// Whisper's own rule for "no speech" is no_speech_prob > 0.6 together with
// avg_logprob < -1. Noise that decodes to confident filler ("Thank you")
// still has a poor average log-probability, so the second rule catches it.
const NO_SPEECH_PROB = 0.6;
const LOW_LOGPROB = -1;
const VERY_LOW_LOGPROB = -1.6;
const PROMPT_MAX_CHARS = 200;
// Phrases much longer than this are real speech even at a low score.
const LOW_CONFIDENCE_MAX_SAMPLES = 4 * 16000;
// A prompt on a very short clip makes Whisper continue the prompt instead of
// transcribing, so only phrases with enough audio get one.
const PROMPT_MIN_SAMPLES = 3 * 16000;
const MAX_WORDS_PER_SECOND = 6.5;

// Speech rarely exceeds ~4 words per second, and Whisper runaway loops repeat
// one phrase many times; either is invented text.
function isRunawayText(text: string, samples: number) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (
    words.length >= 8 &&
    words.length / (samples / 16000) > MAX_WORDS_PER_SECOND
  )
    return true;
  for (let size = 2; size <= 6; size++) {
    const counts = new Map<string, number>();
    for (let i = 0; i + size <= words.length; i++) {
      const gram = words.slice(i, i + size).join(' ');
      const count = (counts.get(gram) ?? 0) + 1;
      if (count >= (size === 2 ? 5 : 4)) return true;
      counts.set(gram, count);
    }
  }
  return false;
}

export function isLowConfidenceRecognition(
  result: Pick<Recognition, 'avgLogprob' | 'noSpeechProb' | 'text'>,
  samples: number
) {
  if (isRunawayText(result.text, samples)) return true;
  if (result.avgLogprob === 0) return false;
  return (
    (result.noSpeechProb > NO_SPEECH_PROB && result.avgLogprob < LOW_LOGPROB) ||
    (result.avgLogprob < VERY_LOW_LOGPROB &&
      samples <= LOW_CONFIDENCE_MAX_SAMPLES)
  );
}

export function nativeAsrHelperPath(_runtime: NativeAsrRuntime) {
  const name = 'nota-whisper-helper';
  const override = process.env.NOTA_WHISPER_HELPER_PATH;
  const binary = name + (process.platform === 'win32' ? '.exe' : '');
  const candidates = [
    override,
    process.env.NOTA_NATIVE_ASR_DIR &&
      path.join(process.env.NOTA_NATIVE_ASR_DIR, binary),
    path.join(
      process.cwd(),
      'packages/frontend/apps/electron/resources/native',
      binary
    ),
  ];
  return (
    candidates.find(
      (candidate): candidate is string => !!candidate && existsSync(candidate)
    ) ?? null
  );
}
export function nativeAsrRuntimeAvailable(runtime: NativeAsrRuntime) {
  return nativeAsrHelperPath(runtime) !== null;
}
export function isNativeAsrCached(
  runtime: NativeAsrRuntime,
  modelPath: string
) {
  return workers.has(`${runtime}:${modelPath}`);
}
export function encodeNativeAsrRequest(
  pcm: Int16Array,
  language: string,
  prompt = ''
) {
  const locale = Buffer.from(language, 'utf8');
  const promptBytes = Buffer.from(prompt, 'utf8');
  if (
    !pcm.length ||
    pcm.length > 30 * 16000 ||
    locale.length > 32 ||
    promptBytes.length > 1024
  ) {
    throw new Error(
      'Invalid native ASR request; maximum phrase is 30 seconds.'
    );
  }
  const pcmOffset = 8 + locale.length + promptBytes.length;
  const frame = Buffer.alloc(pcmOffset + pcm.length * 2);
  frame.writeUInt32LE(pcm.length, 0);
  frame.writeUInt16LE(locale.length, 4);
  locale.copy(frame, 6);
  frame.writeUInt16LE(promptBytes.length, 6 + locale.length);
  promptBytes.copy(frame, 8 + locale.length);
  for (let i = 0; i < pcm.length; i++)
    frame.writeInt16LE(pcm[i], pcmOffset + i * 2);
  return frame;
}

// Keep the tail of the previous phrase, cut at a word boundary.
function promptTail(text: string) {
  if (text.length <= PROMPT_MAX_CHARS) return text;
  const tail = text.slice(-PROMPT_MAX_CHARS);
  const space = tail.indexOf(' ');
  return space >= 0 ? tail.slice(space + 1) : tail;
}
class NativeAsrWorker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private waiting: {
    resolve: (value: Recognition) => void;
    reject: (error: Error) => void;
  } | null = null;
  private stderr = '';
  private closed = false;
  private loaded = false;
  private pending = 0;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly key: string
  ) {
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-2000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        if (line.length > 1024 * 1024)
          throw new Error('Native ASR response is too large.');
        const response = JSON.parse(line) as {
          ready?: boolean;
          error?: string;
          text?: unknown;
          language?: unknown;
          noSpeechProb?: unknown;
          avgLogprob?: unknown;
        };
        if (response.error) throw new Error(response.error);
        if (response.ready) {
          this.loaded = true;
          this.readyResolve();
          this.idle();
          return;
        }
        if (typeof response.text !== 'string')
          throw new Error('Invalid native ASR response.');
        this.waiting?.resolve({
          text: response.text.trim(),
          language:
            typeof response.language === 'string' ? response.language : null,
          noSpeechProb:
            typeof response.noSpeechProb === 'number'
              ? response.noSpeechProb
              : 0,
          avgLogprob:
            typeof response.avgLogprob === 'number' ? response.avgLogprob : 0,
        });
        this.waiting = null;
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.on('error', error => this.fail(error));
    child.stdin.on('error', error => this.fail(error));
    child.on('exit', (code, signal) =>
      this.fail(
        new Error(
          `Native ASR helper exited (${signal ?? code}). ${this.stderr}`
        )
      )
    );
    this.timer = setTimeout(
      () => this.fail(new Error('Native ASR model load timed out.')),
      120_000
    );
    this.timer.unref();
    // A spawn failure can arrive before the caller starts awaiting readiness.
    void this.ready.catch(() => {});
  }
  private fail(error: Error) {
    this.readyReject(error);
    this.waiting?.reject(error);
    this.waiting = null;
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    if (workers.get(this.key) === this) workers.delete(this.key);
    const error = new Error('Native ASR helper is closed.');
    this.readyReject(error);
    this.waiting?.reject(error);
    this.waiting = null;
    this.child.kill();
  }
  get canUnload() {
    return this.loaded && this.pending === 0;
  }
  private idle() {
    clearTimeout(this.timer);
    if (this.pending || this.closed) return;
    this.timer = setTimeout(() => this.close(), IDLE_MS);
    this.timer.unref();
  }
  async recognize(
    pcm: Int16Array,
    language: string,
    prompt = ''
  ): Promise<Recognition> {
    const frame = encodeNativeAsrRequest(pcm, language, prompt);
    // A queued request must not cancel the timeout of the current decode.
    if (this.pending === 0 && this.loaded) clearTimeout(this.timer);
    this.pending++;
    const task = this.chain.then(async () => {
      await this.ready;
      if (this.closed) throw new Error('Native ASR helper is closed.');
      return new Promise<Recognition>((resolve, reject) => {
        this.waiting = { resolve, reject };
        this.timer = setTimeout(
          () => this.fail(new Error('Native ASR decode timed out.')),
          120_000
        );
        this.timer.unref();
        this.child.stdin.write(frame, error => {
          if (error) this.fail(error);
        });
      });
    });
    this.chain = task.catch(() => {});
    try {
      return await task;
    } finally {
      this.pending--;
      this.idle();
    }
  }
}
function worker(runtime: NativeAsrRuntime, modelPath: string) {
  const key = `${runtime}:${modelPath}`;
  let loaded = workers.get(key);
  if (!loaded) {
    const helperPath = nativeAsrHelperPath(runtime);
    if (!helperPath)
      throw new Error(`${runtime} helper is not installed in this build.`);
    // Switching sizes should not keep several native model copies in RAM.
    // Requests already decoding are allowed to finish before their idle expiry.
    for (const cached of workers.values()) {
      if (cached.canUnload) cached.close();
    }
    loaded = new NativeAsrWorker(
      spawn(helperPath, [modelPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }),
      key
    );
    workers.set(key, loaded);
  }
  return loaded;
}
export async function preloadNativeAsr(
  runtime: NativeAsrRuntime,
  modelPath: string
) {
  await worker(runtime, modelPath).ready;
}
export function closeNativeAsrWorkers() {
  const current = [...workers.values()];
  workers.clear();
  for (const loaded of current) loaded.close();
}
export async function createNativeAsrDecoder(
  runtime: NativeAsrRuntime,
  modelPath: string,
  language = 'auto'
): Promise<MeetingUtteranceDecoder> {
  await preloadNativeAsr(runtime, modelPath);
  let chunks: Int16Array[] = [];
  let count = 0;
  // Whisper re-detects the language for every phrase, and short phrases flip
  // to Dutch, Malay or Turkish with invented text. 'auto' detects on long
  // phrases only, then keeps the language the meeting agrees on.
  const votes = new Map<string, number>();
  let locked: string | null = null;
  // The previous accepted phrase conditions the next one (names, spelling,
  // vocabulary). It is cleared when a phrase is dropped so a hallucination
  // cannot feed the next decode.
  let previous = '';
  return {
    executionProvider:
      process.env.NOTA_ASR_GPU === '0' ? 'whisper-cpp-cpu' : 'whisper-cpp-gpu',
    supportsPartials: false,
    pushPcm16(pcm) {
      chunks.push(pcm.slice());
      count += pcm.length;
    },
    async partial() {
      return null;
    },
    async finish() {
      const pcm = new Int16Array(count);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      chunks = [];
      count = 0;
      if (!pcm.length) return { text: '', language: null };
      const results: Recognition[] = [];
      const requested = language === 'auto' && locked ? locked : language;
      // The helper's 30 s input limit never caps the whole meeting/file.
      for (let start = 0; start < pcm.length; start += 20 * 16000) {
        const loaded = worker(runtime, modelPath);
        const piece = pcm.subarray(start, start + 20 * 16000);
        const result = await loaded.recognize(
          piece,
          requested,
          piece.length >= PROMPT_MIN_SAMPLES ? promptTail(previous) : ''
        );
        if (isLowConfidenceRecognition(result, piece.length)) {
          previous = '';
          continue;
        }
        results.push(result);
        if (result.text) previous = result.text;
      }
      const detected = results.find(r => r.text)?.language ?? null;
      if (
        language === 'auto' &&
        !locked &&
        detected &&
        pcm.length >= LANGUAGE_VOTE_MIN_SAMPLES
      ) {
        const total = (votes.get(detected) ?? 0) + 1;
        votes.set(detected, total);
        if (total >= LANGUAGE_LOCK_VOTES) locked = detected;
      }
      return {
        text: results
          .map(r => r.text)
          .filter(Boolean)
          .join(' '),
        language: detected,
      };
    },
  };
}
process.once('exit', closeNativeAsrWorkers);
