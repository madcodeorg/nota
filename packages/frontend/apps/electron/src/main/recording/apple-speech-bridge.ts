import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from 'node:child_process';
import fs from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { fetchAiBackend } from '../ai-backend';
import { beforeRecordingStateClear } from './cleanup-hooks';
import { getRawAudioBuffers } from './feature';
import { ensureNativeRecordingRuntimeDependencies } from './native-runtime';

const execFileAsync = promisify(execFile);
const APPLE_SPEECH_TRANSCRIPT_RETRY_DELAYS_MS = [100, 250, 500] as const;
const APPLE_SPEECH_BACKEND_ATTEMPT_TIMEOUT_MS = 3000;

type NativeAppleSpeechTranscriptEvent =
  | {
      confidence?: number;
      endMs: number;
      source?: 'mic' | 'system';
      startMs: number;
      text: string;
      type: 'final' | 'partial';
    }
  | {
      code?: string;
      message: string;
      type: 'error';
    };

export type NativeAppleSpeechSession = {
  pushAudioFrame?(frame: AppleSpeechAudioFrame): Promise<void> | void;
  stop(): void | Promise<void>;
};

export class AppleSpeechTranscriptPostTracker {
  private blocked = false;
  private blockedError: unknown;
  private blockedErrorReported = false;
  private pump: Promise<void> | null = null;
  private readonly queue: Array<{
    onError: (error: unknown) => void;
    task: () => Promise<unknown>;
  }> = [];

  track(task: () => Promise<unknown>, onError: (error: unknown) => void) {
    this.queue.push({ onError, task });
    if (!this.blocked) {
      this.startPump();
    }
  }

  async drain() {
    // A failed task stays at the head of this ordered journal. The first drain
    // reports the failure so meeting finalization cannot continue without its
    // transcript. A later Stop retries that exact task before later events.
    if (this.blocked) {
      if (!this.blockedErrorReported) {
        this.blockedErrorReported = true;
        throw new AggregateError(
          [this.blockedError],
          'Failed to post Apple Speech transcript events.'
        );
      }
      this.blocked = false;
      this.blockedErrorReported = false;
      this.startPump();
    } else if (this.queue.length) {
      this.startPump();
    }

    while (this.pump) {
      await this.pump;
    }

    if (this.blocked) {
      this.blockedErrorReported = true;
      throw new AggregateError(
        [this.blockedError],
        'Failed to post Apple Speech transcript events.'
      );
    }
  }

  private startPump() {
    if (this.pump || this.blocked || !this.queue.length) {
      return;
    }

    let pump: Promise<void>;
    pump = (async () => {
      while (this.queue.length && !this.blocked) {
        const entry = this.queue[0];
        try {
          await entry.task();
          this.queue.shift();
        } catch (error) {
          this.blocked = true;
          this.blockedError = error;
          this.blockedErrorReported = false;
          try {
            entry.onError(error);
          } catch (handlerError) {
            console.warn(
              'Apple Speech transcript error handler failed',
              handlerError
            );
          }
        }
      }
    })().finally(() => {
      if (this.pump === pump) {
        this.pump = null;
      }
    });
    this.pump = pump;
  }
}

export async function drainAppleSpeechTranscriptTail(input: {
  flushTail(): void;
  posts: AppleSpeechTranscriptPostTracker;
  sourceClosed: Promise<void>;
}) {
  await input.sourceClosed;
  input.flushTail();
  await input.posts.drain();
}

export async function drainAppleSpeechAudioTail(pump: () => Promise<boolean>) {
  while (await pump()) {
    // `getRawAudioBuffers` is intentionally bounded for long recordings. Keep
    // pumping until a finalized archive read reaches EOF.
  }
}

type AppleSpeechSessionInput = {
  locale?: string;
  channels?: number;
  meetingId: string;
  recordingId?: number;
  sampleRate?: number;
  source?: 'mic' | 'system';
};

type NativeAppleSpeechAnalyzer = {
  isAvailable?: () => boolean | Promise<boolean>;
  start: (
    input: {
      meetingId: string;
      sampleRate?: number;
      source?: 'mic' | 'system';
    },
    callback: (event: NativeAppleSpeechTranscriptEvent) => void
  ) => NativeAppleSpeechSession | Promise<NativeAppleSpeechSession>;
};

type AppleSpeechHelperOutput = {
  available?: boolean;
  command?: string;
  endMs?: number;
  error?: string;
  locale?: string;
  supportedLocales?: string[];
  installedLocales?: string[];
  systemLocale?: string;
  ok?: boolean;
  source?: 'mic' | 'system';
  startMs?: number;
  text?: string;
  type?: string;
};

export type AppleSpeechBridgeStatus = {
  supportedLocales?: string[];
  installedLocales?: string[];
  systemLocale?: string | null;
  available: boolean;
  reason: string | null;
  version: string | null;
};

export type AppleSpeechFileTranscription = {
  duration: number;
  model: 'apple-speechanalyzer';
  provider: 'apple';
  text: string;
};

export type AppleSpeechTranscriptEvent =
  | {
      confidence?: number;
      endMs: number;
      source?: 'mic' | 'system';
      startMs: number;
      text: string;
      type: 'final' | 'partial';
    }
  | {
      code?: string;
      message: string;
      type: 'error';
    };

export type AppleSpeechAudioFrame = {
  channels: number;
  endMs: number;
  encoding: 'f32le';
  frameId?: string;
  pcmBase64: string;
  sampleRate: number;
  source?: 'mic' | 'system';
  startMs: number;
};

export function appleSpeechSystemFrameId(
  startCursor: number,
  endCursor: number
) {
  return `system:${startCursor}:${endCursor}`;
}

export function appleSpeechHelperAudioCommand(frame: AppleSpeechAudioFrame) {
  return `${JSON.stringify({
    endMs: frame.endMs,
    frameId: frame.frameId,
    pcmBase64: frame.pcmBase64,
    startMs: frame.startMs,
    type: 'audio',
  })}\n`;
}

let bridgeStatus: AppleSpeechBridgeStatus = {
  available: false,
  reason: 'Native Apple SpeechAnalyzer bridge is not implemented yet.',
  version: null,
};
function appleSpeechSessionKey(meetingId: string, source: 'mic' | 'system') {
  return `${meetingId}:${source}`;
}

export class AppleSpeechSessionRegistry {
  private readonly completedMeetings = new Set<string>();
  private readonly sessions = new Map<string, NativeAppleSpeechSession>();
  private readonly stops = new Map<string, Promise<void>>();

  get(
    meetingId: string,
    source: 'mic' | 'system'
  ): NativeAppleSpeechSession | undefined {
    return this.sessions.get(appleSpeechSessionKey(meetingId, source));
  }

  set(
    meetingId: string,
    source: 'mic' | 'system',
    session: NativeAppleSpeechSession
  ) {
    this.completedMeetings.delete(meetingId);
    this.sessions.set(appleSpeechSessionKey(meetingId, source), session);
  }

  async stopMeeting(meetingId: string) {
    const sessions = this.entriesForMeeting(this.sessions, meetingId);
    const pendingStops = this.entriesForMeeting(this.stops, meetingId);
    if (!sessions.length && !pendingStops.length) {
      return this.completedMeetings.has(meetingId);
    }
    await drainAppleSpeechStopPromises(
      new Set([
        ...pendingStops.map(([, stop]) => stop),
        ...sessions.map(([key, session]) => this.stopSession(key, session)),
      ])
    );
    this.completedMeetings.add(meetingId);
    return true;
  }

  async stopAll() {
    const entries = [...this.sessions.entries()];
    const pendingStops = [...this.stops.values()];
    if (!entries.length && !pendingStops.length) {
      return;
    }
    await drainAppleSpeechStopPromises(
      new Set([
        ...pendingStops,
        ...entries.map(([key, session]) => this.stopSession(key, session)),
      ])
    );
  }

  private entriesForMeeting<T>(entries: Map<string, T>, meetingId: string) {
    const prefix = `${meetingId}:`;
    return [...entries.entries()].filter(([key]) => key.startsWith(prefix));
  }

  private stopSession(key: string, session: NativeAppleSpeechSession) {
    const existing = this.stops.get(key);
    if (existing) {
      return existing;
    }

    let stop: Promise<void>;
    stop = Promise.resolve()
      .then(() => session.stop())
      .then(() => {
        if (this.sessions.get(key) === session) {
          this.sessions.delete(key);
        }
      })
      .finally(() => {
        if (this.stops.get(key) === stop) {
          this.stops.delete(key);
        }
      });
    this.stops.set(key, stop);
    return stop;
  }
}

const appleSpeechSessionRegistry = new AppleSpeechSessionRegistry();

function appleSpeechHelperCandidates() {
  const binaryName = 'nota-apple-speech-helper';
  const appleBuildArch =
    process.arch === 'arm64' ? 'arm64-apple-macosx' : 'x86_64-apple-macosx';
  return [
    process.env.NOTA_APPLE_SPEECH_HELPER,
    process.resourcesPath
      ? path.resolve(process.resourcesPath, 'native', binaryName)
      : undefined,
    path.resolve(__dirname, '../resources/native', binaryName),
    path.resolve(process.cwd(), 'resources/native', binaryName),
    path.resolve(
      process.cwd(),
      'packages/frontend/apps/electron/resources/native',
      binaryName
    ),
    path.resolve(
      process.cwd(),
      'native/apple-speech-helper/.build',
      appleBuildArch,
      'debug',
      binaryName
    ),
    path.resolve(
      process.cwd(),
      'native/apple-speech-helper/.build/debug',
      binaryName
    ),
    path.resolve(
      process.cwd(),
      'native/apple-speech-helper/.build',
      appleBuildArch,
      'release',
      binaryName
    ),
    path.resolve(
      __dirname,
      '../../../native/apple-speech-helper/.build/debug',
      binaryName
    ),
    path.resolve(
      __dirname,
      '../../../native/apple-speech-helper/.build/release',
      binaryName
    ),
    process.resourcesPath
      ? path.resolve(
          process.resourcesPath,
          'app.asar.unpacked',
          'native',
          binaryName
        )
      : undefined,
  ].filter((candidate): candidate is string => !!candidate);
}

function appleSpeechHelperPath() {
  return appleSpeechHelperCandidates().find(candidate =>
    fs.existsSync(candidate)
  );
}

function parseHelperOutput(stdout: string): AppleSpeechHelperOutput {
  const line = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .reverse()
    .find(Boolean);
  if (!line) {
    throw new Error('Apple Speech helper produced no output.');
  }
  return JSON.parse(line) as AppleSpeechHelperOutput;
}

async function runAppleSpeechHelper(args: string[]) {
  if (process.platform !== 'darwin') {
    throw new Error('Apple Speech helper is only available on macOS.');
  }

  const helperPath = appleSpeechHelperPath();
  if (!helperPath) {
    throw new Error(
      'Apple Speech helper is not built. Run swift build --package-path packages/frontend/apps/electron/native/apple-speech-helper.'
    );
  }

  const { stdout } = await execFileAsync(helperPath, args, {
    maxBuffer: 1024 * 1024 * 32,
    timeout: 1000 * 60 * 20,
  });
  const output = parseHelperOutput(stdout);
  if (output.ok === false) {
    throw new Error(output.error || 'Apple Speech helper failed.');
  }
  return output;
}

function writeUInt32LE(buffer: Buffer, value: number, offset: number) {
  buffer.writeUInt32LE(Math.max(0, Math.floor(value)), offset);
}

function float32WavBuffer(raw: Buffer, sampleRate: number, channels: number) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * Float32Array.BYTES_PER_ELEMENT;
  const blockAlign = channels * Float32Array.BYTES_PER_ELEMENT;

  header.write('RIFF', 0, 'ascii');
  writeUInt32LE(header, raw.byteLength + 36, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  writeUInt32LE(header, 16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(channels, 22);
  writeUInt32LE(header, sampleRate, 24);
  writeUInt32LE(header, byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36, 'ascii');
  writeUInt32LE(header, raw.byteLength, 40);
  return Buffer.concat([header, raw]);
}

function audioDurationSeconds(
  bytes: number,
  sampleRate: number,
  channels: number
) {
  const bytesPerFrame = Float32Array.BYTES_PER_ELEMENT * channels;
  if (!bytesPerFrame || !sampleRate) {
    return 0;
  }
  return bytes / bytesPerFrame / sampleRate;
}

function audioCursorToMs(cursor: number, sampleRate: number, channels: number) {
  return Math.round(audioDurationSeconds(cursor, sampleRate, channels) * 1000);
}

function normalizeAppleSpeechSessionInput(
  input: string | AppleSpeechSessionInput
): AppleSpeechSessionInput {
  if (typeof input === 'string') {
    return { meetingId: input };
  }
  return input;
}

function parseHelperJsonLines(
  chunk: Buffer,
  state: { buffer: string },
  onLine: (line: AppleSpeechHelperOutput) => void
) {
  state.buffer += chunk.toString('utf8');
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    onLine(JSON.parse(trimmed));
  }
}

async function createHelperAppleSpeechSession(
  input: AppleSpeechSessionInput
): Promise<NativeAppleSpeechSession | null> {
  const helperPath = appleSpeechHelperPath();
  if (!helperPath) {
    return null;
  }

  const sampleRate = Math.max(1, Math.round(input.sampleRate ?? 48000));
  const channels = Math.max(1, Math.round(input.channels ?? 2));
  const source = input.source ?? 'system';
  const status = await runAppleSpeechHelper([
    'status',
    ...(input.locale ? [input.locale] : []),
  ]);
  if (status.available !== true) {
    return null;
  }

  const child: ChildProcessWithoutNullStreams = spawn(
    helperPath,
    [
      'transcribe-stream',
      String(sampleRate),
      String(channels),
      source,
      ...(input.locale ? [input.locale] : []),
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  const stdoutState = { buffer: '' };
  const transcriptPosts = new AppleSpeechTranscriptPostTracker();
  let cursor = 0;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;

  const handleHelperLine = (line: AppleSpeechHelperOutput) => {
    if (line.type === 'ready') {
      return;
    }
    if (line.ok === false || line.type === 'error') {
      transcriptPosts.track(
        () =>
          pushAppleSpeechTranscriptEvent(input.meetingId, {
            code: 'apple_speech_helper_stream_failed',
            message: line.error || 'Apple Speech helper stream failed.',
            type: 'error',
          }),
        error => console.warn('Failed to post Apple Speech helper error', error)
      );
      return;
    }
    if (line.text?.trim()) {
      const text = line.text.trim();
      const startMs =
        typeof line.startMs === 'number'
          ? line.startMs
          : audioCursorToMs(cursor, sampleRate, channels);
      const endMs =
        typeof line.endMs === 'number'
          ? line.endMs
          : Math.max(startMs, audioCursorToMs(cursor, sampleRate, channels));
      transcriptPosts.track(
        () =>
          pushAppleSpeechTranscriptEvent(input.meetingId, {
            endMs,
            source: line.source ?? source,
            startMs,
            text,
            type: line.type === 'final' ? 'final' : 'partial',
          }),
        error =>
          console.warn('Failed to post Apple Speech helper transcript', error)
      );
    }
  };

  const flushStdoutTail = () => {
    const tail = stdoutState.buffer.trim();
    stdoutState.buffer = '';
    if (!tail) {
      return;
    }
    try {
      handleHelperLine(JSON.parse(tail) as AppleSpeechHelperOutput);
    } catch (error) {
      console.warn('Failed to parse Apple Speech helper output tail', error);
    }
  };

  const helperClosed = new Promise<void>(resolve => {
    child.once('close', () => resolve());
  });

  child.stdout.on('data', chunk => {
    try {
      parseHelperJsonLines(chunk, stdoutState, handleHelperLine);
    } catch (error) {
      console.warn('Failed to parse Apple Speech helper output', error);
    }
  });
  child.stdout.once('end', flushStdoutTail);

  child.stderr.on('data', chunk => {
    console.warn('Apple Speech helper stderr', chunk.toString('utf8'));
  });

  child.on('exit', code => {
    if (!stopped && code !== 0) {
      transcriptPosts.track(
        () =>
          pushAppleSpeechTranscriptEvent(input.meetingId, {
            code: 'apple_speech_helper_exited',
            message: `Apple Speech helper exited with code ${code ?? 'unknown'}.`,
            type: 'error',
          }),
        error => console.warn('Failed to post Apple Speech helper exit', error)
      );
    }
  });

  async function writeAudioFrame(frame: AppleSpeechAudioFrame) {
    if (stopped || !frame.pcmBase64.trim()) {
      return;
    }
    if (child.stdin.destroyed) {
      throw new Error('Apple Speech helper audio stream is closed.');
    }
    const payload = appleSpeechHelperAudioCommand(frame);
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(payload, error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  const pumpRecordingAudio = async (force = false) => {
    if (typeof input.recordingId !== 'number') {
      return false;
    }
    const startCursor = cursor;
    const { buffer, nextCursor } = await getRawAudioBuffers(
      input.recordingId,
      startCursor
    );
    if ((!force && stopped) || !buffer.byteLength) {
      cursor = nextCursor;
      return false;
    }
    const startMs = audioCursorToMs(startCursor, sampleRate, channels);
    const endMs = audioCursorToMs(nextCursor, sampleRate, channels);
    await writeAudioFrame({
      channels,
      encoding: 'f32le',
      endMs,
      frameId: appleSpeechSystemFrameId(startCursor, nextCursor),
      pcmBase64: buffer.toString('base64'),
      sampleRate,
      source,
      startMs,
    });
    cursor = nextCursor;
    return nextCursor > startCursor;
  };

  let pumpQueue: Promise<unknown> = Promise.resolve();
  const queueRecordingAudioPump = (force = false) => {
    const queued = pumpQueue
      .catch(() => {})
      .then(() => pumpRecordingAudio(force));
    pumpQueue = queued;
    return queued;
  };

  const pump =
    typeof input.recordingId === 'number'
      ? setInterval(() => {
          queueRecordingAudioPump().catch(error => {
            console.warn('Failed to pump Apple Speech audio', error);
          });
        }, 750)
      : null;

  return {
    pushAudioFrame(frame) {
      return writeAudioFrame(frame);
    },
    stop() {
      if (stopPromise) {
        return stopPromise;
      }

      const attempt = (async () => {
        let forceClose: ReturnType<typeof setTimeout> | null = null;
        if (!stopped) {
          if (pump) {
            clearInterval(pump);
          }
          // Do not close the helper if its final raw-audio pump failed. The
          // retained session lets Retry Stop flush that same archive tail.
          await drainAppleSpeechAudioTail(() => queueRecordingAudioPump(true));
          stopped = true;
          try {
            child.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`);
            child.stdin.end();
          } catch {
            // The helper may already have exited.
          }

          forceClose = setTimeout(() => {
            forceClose = null;
            if (child.exitCode === null) {
              child.kill();
            }
          }, 5000);
          forceClose.unref();
        }

        try {
          // `close` follows stdout EOF. Flush a non-newline-terminated final
          // JSON object, then require every backend post it created to land.
          await drainAppleSpeechTranscriptTail({
            flushTail: flushStdoutTail,
            posts: transcriptPosts,
            sourceClosed: helperClosed,
          });
        } finally {
          if (forceClose) {
            clearTimeout(forceClose);
          }
        }
      })();
      stopPromise = attempt;
      void attempt
        .finally(() => {
          if (stopPromise === attempt) {
            stopPromise = null;
          }
        })
        .catch(() => {});
      return stopPromise;
    },
  };
}

type PostJsonResult =
  | { body: unknown; ok: true; status: number }
  | { ok: false; status: number };

async function postJsonRequest(
  path: string,
  body: unknown
): Promise<PostJsonResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutError = new Error(
    `AI backend request timed out after ${APPLE_SPEECH_BACKEND_ATTEMPT_TIMEOUT_MS}ms.`
  );
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, APPLE_SPEECH_BACKEND_ATTEMPT_TIMEOUT_MS);
    timeout.unref?.();
  });
  const request = (async () => {
    const response = await fetchAiBackend(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status } as const;
    }
    return {
      body: (await response.json()) as unknown,
      ok: true,
      status: response.status,
    } as const;
  })();

  try {
    return await Promise.race([request, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function wait(delayMs: number) {
  return new Promise<void>(resolve => setTimeout(resolve, delayMs));
}

function httpError(status: number) {
  return new Error(`AI backend returned HTTP ${status}`);
}

async function postJson(path: string, body: unknown) {
  const result = await postJsonRequest(path, body);
  if (!result.ok) {
    throw httpError(result.status);
  }
  return result.body;
}

async function postAppleSpeechTranscriptJson(path: string, body: unknown) {
  let attemptedBridgeRegistration = false;
  for (
    let attempt = 0;
    attempt <= APPLE_SPEECH_TRANSCRIPT_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    let result: PostJsonResult;
    try {
      result = await postJsonRequest(path, body);
    } catch (error) {
      const delayMs = APPLE_SPEECH_TRANSCRIPT_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        throw error;
      }
      await wait(delayMs);
      continue;
    }

    if (result.ok) {
      return result.body;
    }

    const error = httpError(result.status);
    const delayMs = APPLE_SPEECH_TRANSCRIPT_RETRY_DELAYS_MS[attempt];
    const isServerError = result.status >= 500 && result.status <= 599;
    if (!isServerError || delayMs === undefined) {
      throw error;
    }
    if (result.status === 503 && !attemptedBridgeRegistration) {
      attemptedBridgeRegistration = true;
      await postJson('/v1/stt/apple-speech/bridge', bridgeStatus).catch(
        registerError =>
          console.warn(
            'Failed to restore Apple SpeechAnalyzer bridge registration',
            registerError
          )
      );
    }
    await wait(delayMs);
  }

  throw new Error('Apple Speech transcript retry loop exhausted.');
}

export function getAppleSpeechBridgeStatus() {
  return bridgeStatus;
}

export async function getAppleSpeechFileTranscriptionStatus() {
  try {
    const output = await runAppleSpeechHelper(['status']);
    return {
      available: output.available === true,
      locale: output.locale ?? null,
      reason:
        output.available === true
          ? null
          : 'Apple SpeechTranscriber is unavailable.',
      version: 'swift-apple-speech-helper',
    };
  } catch (error) {
    return {
      available: false,
      locale: null,
      reason: error instanceof Error ? error.message : String(error),
      version: null,
    };
  }
}

export async function registerAppleSpeechBridge(
  status: Partial<AppleSpeechBridgeStatus> = {}
) {
  bridgeStatus = {
    ...bridgeStatus,
    ...(status.supportedLocales
      ? { supportedLocales: status.supportedLocales }
      : {}),
    ...(status.installedLocales
      ? { installedLocales: status.installedLocales }
      : {}),
    ...(status.systemLocale !== undefined
      ? { systemLocale: status.systemLocale }
      : {}),
    available: status.available === true,
    reason:
      typeof status.reason === 'string'
        ? status.reason
        : status.available === true
          ? null
          : bridgeStatus.reason,
    version: typeof status.version === 'string' ? status.version : null,
  };

  try {
    await postJson('/v1/stt/apple-speech/bridge', bridgeStatus);
  } catch (error) {
    console.warn('Failed to register Apple SpeechAnalyzer bridge', error);
  }

  return bridgeStatus;
}

export async function pushAppleSpeechTranscriptEvent(
  meetingId: string,
  event: AppleSpeechTranscriptEvent
) {
  if (!meetingId.trim()) {
    throw new Error('meetingId is required.');
  }
  return postAppleSpeechTranscriptJson(
    `/v1/meetings/${encodeURIComponent(meetingId)}/apple-speech/events`,
    event
  );
}

export async function pushAppleSpeechAudioFrame(
  meetingId: string,
  frame: AppleSpeechAudioFrame
) {
  if (!meetingId.trim()) {
    throw new Error('meetingId is required.');
  }
  const source = frame.source ?? 'mic';
  const session = appleSpeechSessionRegistry.get(meetingId, source);
  if (!session?.pushAudioFrame) {
    throw new Error(`Apple Speech ${source} stream is not running.`);
  }
  await session.pushAudioFrame({ ...frame, source });
}

async function nativeAppleSpeechAnalyzer() {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    ensureNativeRecordingRuntimeDependencies();
    const native = (await import('@nota/native')) as {
      AppleSpeechAnalyzer?: NativeAppleSpeechAnalyzer;
    };
    return native.AppleSpeechAnalyzer ?? null;
  } catch {
    return null;
  }
}

export async function startAppleSpeechTranscription(
  rawInput: string | AppleSpeechSessionInput
) {
  const input = { ...normalizeAppleSpeechSessionInput(rawInput) };
  if (!input.locale) {
    const response = await fetchAiBackend(
      `/v1/meetings/${encodeURIComponent(input.meetingId)}`
    );
    if (!response.ok)
      throw new Error('Could not read the reserved Apple speech language.');
    const data = (await response.json()) as {
      meeting?: { sttLanguage?: string };
    };
    const language = data.meeting?.sttLanguage;
    if (language && language !== 'auto') input.locale = language;
  }
  const meetingId = input.meetingId;
  if (!meetingId.trim()) {
    throw new Error('meetingId is required.');
  }

  const source = input.source ?? 'system';
  const existing = appleSpeechSessionRegistry.get(meetingId, source);
  if (existing) {
    return bridgeStatus;
  }

  const helperSession = await createHelperAppleSpeechSession(input);
  if (helperSession) {
    await registerAppleSpeechBridge({
      available: true,
      version: 'swift-apple-speech-helper-stream',
    });
    appleSpeechSessionRegistry.set(meetingId, source, helperSession);
    return bridgeStatus;
  }

  if (input.locale) {
    throw new Error(
      'Selecting an Apple speech language requires the Swift helper in a rebuilt desktop app.'
    );
  }

  if (source === 'mic' && typeof input.recordingId !== 'number') {
    return registerAppleSpeechBridge({
      available: false,
      reason: 'Apple Speech microphone streaming requires the Swift helper.',
    });
  }

  const analyzer = await nativeAppleSpeechAnalyzer();
  if (!analyzer) {
    return registerAppleSpeechBridge({
      available: false,
      reason: 'Native Apple SpeechAnalyzer binding is not available.',
    });
  }

  const available = analyzer.isAvailable ? await analyzer.isAvailable() : true;
  if (!available) {
    return registerAppleSpeechBridge({
      available: false,
      reason: 'Native Apple SpeechAnalyzer binding reported unavailable.',
    });
  }

  await registerAppleSpeechBridge({
    available: true,
    version: 'native-apple-speech-analyzer',
  });

  const transcriptPosts = new AppleSpeechTranscriptPostTracker();
  const nativeSession = await analyzer.start(
    {
      meetingId,
      sampleRate: input.sampleRate ?? 16000,
      source: input.source ?? 'system',
    },
    event => {
      transcriptPosts.track(
        () => pushAppleSpeechTranscriptEvent(meetingId, event),
        error =>
          console.warn('Failed to push Apple SpeechAnalyzer event', error)
      );
    }
  );
  let nativeStopped = false;
  const session: NativeAppleSpeechSession = {
    ...(nativeSession.pushAudioFrame
      ? {
          pushAudioFrame: (frame: AppleSpeechAudioFrame) =>
            nativeSession.pushAudioFrame?.(frame),
        }
      : {}),
    async stop() {
      if (!nativeStopped) {
        await nativeSession.stop();
        nativeStopped = true;
      }
      await transcriptPosts.drain();
    },
  };
  appleSpeechSessionRegistry.set(meetingId, source, session);
  return bridgeStatus;
}

export async function stopAppleSpeechTranscription(meetingId: string) {
  return appleSpeechSessionRegistry.stopMeeting(meetingId);
}

async function drainAppleSpeechStopPromises(stops: Iterable<Promise<void>>) {
  const results = await Promise.allSettled(stops);
  const errors = results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : []
  );
  if (errors.length) {
    throw new AggregateError(errors, 'Failed to stop Apple Speech sessions.');
  }
}

export async function drainAppleSpeechSessions(
  sessions: Array<{ stop(): void | Promise<void> }>
) {
  await drainAppleSpeechStopPromises(
    sessions.map(session => Promise.resolve().then(() => session.stop()))
  );
}

export async function stopAllAppleSpeechTranscriptions() {
  await appleSpeechSessionRegistry.stopAll();
}

beforeRecordingStateClear(stopAllAppleSpeechTranscriptions);

export async function transcribeAppleSpeechRawRecording(input: {
  channels?: number;
  filepath: string;
  sampleRate?: number;
  locale?: string;
}): Promise<AppleSpeechFileTranscription | null> {
  const sampleRate = Math.max(1, Math.round(input.sampleRate ?? 48000));
  const channels = Math.max(1, Math.round(input.channels ?? 2));
  const raw = await readFile(input.filepath);
  if (!raw.byteLength) {
    return null;
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'nota-apple-speech-')
  );
  const wavPath = path.join(tempDir, 'meeting.wav');
  try {
    await writeFile(wavPath, float32WavBuffer(raw, sampleRate, channels));
    const output = await runAppleSpeechHelper([
      'transcribe-file',
      wavPath,
      ...(input.locale ? [input.locale] : []),
    ]);
    const text = (output.text ?? '').trim();
    if (!text) {
      return null;
    }
    return {
      duration: audioDurationSeconds(raw.byteLength, sampleRate, channels),
      model: 'apple-speechanalyzer',
      provider: 'apple',
      text,
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => {});
  }
}

export async function prepareAppleSpeechLanguage(locale: string) {
  const inventory = await runAppleSpeechHelper(['languages']);
  if (!inventory.supportedLocales?.includes(locale))
    throw new Error('Unsupported Apple speech language.');
  const output = await runAppleSpeechHelper(['prepare-language', locale]);
  return registerAppleSpeechBridge({
    available: output.available === true,
    supportedLocales: output.supportedLocales,
    installedLocales: output.installedLocales,
    systemLocale: output.systemLocale ?? null,
    version: 'swift-apple-speech-helper',
  });
}

export async function setupAppleSpeechBridge() {
  if (process.platform !== 'darwin') {
    return await registerAppleSpeechBridge({
      available: false,
      reason: 'Apple SpeechAnalyzer is only available on macOS.',
    });
  }

  try {
    const output = await runAppleSpeechHelper(['languages']);
    if (output.available === true) {
      return await registerAppleSpeechBridge({
        available: true,
        version: 'swift-apple-speech-helper',
        supportedLocales: output.supportedLocales,
        installedLocales: output.installedLocales,
        systemLocale: output.systemLocale ?? null,
      });
    }
  } catch {
    // Fall back to the native binding status below.
  }

  const analyzer = await nativeAppleSpeechAnalyzer();
  if (!analyzer) {
    return await registerAppleSpeechBridge({
      available: false,
      reason: 'Native Apple SpeechAnalyzer binding is not available.',
    });
  }

  const available = analyzer.isAvailable ? await analyzer.isAvailable() : true;
  return await registerAppleSpeechBridge({
    available,
    reason: available
      ? null
      : 'Native Apple SpeechAnalyzer binding reported unavailable.',
    version: available ? 'native-apple-speech-analyzer' : null,
  });
}
