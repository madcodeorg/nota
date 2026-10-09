import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type { MeetingUtteranceDecoder } from './meeting-capture-pipeline';

export type NativeAsrRuntime = 'whisper.cpp';
type Recognition = { text: string; language: string | null };
const workers = new Map<string, NativeAsrWorker>();
const IDLE_MS = 60_000;

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
export function encodeNativeAsrRequest(pcm: Int16Array, language: string) {
  const locale = Buffer.from(language, 'utf8');
  if (!pcm.length || pcm.length > 30 * 16000 || locale.length > 32) {
    throw new Error(
      'Invalid native ASR request; maximum phrase is 30 seconds.'
    );
  }
  const frame = Buffer.alloc(6 + locale.length + pcm.length * 2);
  frame.writeUInt32LE(pcm.length, 0);
  frame.writeUInt16LE(locale.length, 4);
  locale.copy(frame, 6);
  for (let i = 0; i < pcm.length; i++)
    frame.writeInt16LE(pcm[i], 6 + locale.length + i * 2);
  return frame;
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
  async recognize(pcm: Int16Array, language: string): Promise<Recognition> {
    const frame = encodeNativeAsrRequest(pcm, language);
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
      // The helper's 30 s input limit never caps the whole meeting/file.
      for (let start = 0; start < pcm.length; start += 20 * 16000) {
        const loaded = worker(runtime, modelPath);
        results.push(
          await loaded.recognize(
            pcm.subarray(start, start + 20 * 16000),
            language
          )
        );
      }
      return {
        text: results
          .map(r => r.text)
          .filter(Boolean)
          .join(' '),
        language: results.find(r => r.text)?.language ?? null,
      };
    },
  };
}
process.once('exit', closeNativeAsrWorkers);
