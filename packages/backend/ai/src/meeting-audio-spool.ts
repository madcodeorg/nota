import { randomUUID } from 'node:crypto';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type MeetingAudioSource = 'mic' | 'system';

export interface MeetingFallbackAudioChunk {
  durationMs: number;
  endMs: number;
  id: string;
  level: number;
  pcm16: Int16Array;
  sampleRate: 16000;
  source: MeetingAudioSource;
  startMs: number;
}

interface StoredAudioChunkHeader extends Omit<
  MeetingFallbackAudioChunk,
  'pcm16'
> {
  pcmBytes: number;
  speech?: boolean;
  version: 1 | 2;
}

export interface MeetingNormalizedAudioFrame extends Omit<
  MeetingFallbackAudioChunk,
  'id'
> {
  speech: boolean;
}

const HEADER_SIZE_BYTES = 4;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_RECORD_MS = 30_000;
const MAX_RECORD_PCM_BYTES = 16000 * 30 * Int16Array.BYTES_PER_ELEMENT;
// Refuse new input at these limits; never evict accepted, unrecovered audio.
export const MEETING_AUDIO_MAX_BYTES = 1024 * 1024 * 1024;
export const MEETING_AUDIO_MAX_FRAMES = 250_000;

export function mergeMeetingAudioFrames(
  frames: MeetingNormalizedAudioFrame[],
  source: MeetingAudioSource
): MeetingFallbackAudioChunk | null {
  if (!frames.length) return null;
  const lastFrame = frames.at(-1);
  if (!lastFrame) {
    throw new Error('Meeting audio buffer is missing its final frame.');
  }
  const pcm16 = new Int16Array(
    frames.reduce((total, frame) => total + frame.pcm16.length, 0)
  );
  let cursor = 0;
  let weightedLevel = 0;
  let durationMs = 0;
  for (const frame of frames) {
    pcm16.set(frame.pcm16, cursor);
    cursor += frame.pcm16.length;
    durationMs += frame.durationMs;
    weightedLevel += frame.level * frame.durationMs;
  }
  return {
    durationMs,
    endMs: lastFrame.endMs,
    id: randomUUID(),
    level: durationMs ? weightedLevel / durationMs : 0,
    pcm16,
    sampleRate: 16000,
    source,
    startMs: frames[0].startMs,
  };
}

// Shared by live ingestion and streaming journal recovery, including a stopped
// tail. Both PCM size and duration are bounded even for continuous speech.
export class MeetingAudioVadBuffer {
  private frames: MeetingNormalizedAudioFrame[] = [];
  private hasSpeech = false;
  private silenceMs = 0;
  private durationMs = 0;
  private pcmBytes = 0;

  append(frame: MeetingNormalizedAudioFrame) {
    this.frames.push(frame);
    this.durationMs += frame.durationMs;
    this.pcmBytes += frame.pcm16.byteLength;
    if (frame.speech) {
      this.hasSpeech = true;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frame.durationMs;
      if (!this.hasSpeech) {
        while (
          this.frames.length > 1 &&
          (this.durationMs > 300 || this.pcmBytes > 16000 * 2)
        ) {
          const removed = this.frames.shift();
          if (!removed) {
            throw new Error('Meeting audio buffer is missing a queued frame.');
          }
          this.durationMs -= removed.durationMs;
          this.pcmBytes -= removed.pcm16.byteLength;
        }
      }
    }
    if (
      (this.hasSpeech && this.silenceMs >= 400) ||
      this.durationMs >= MAX_RECORD_MS ||
      this.pcmBytes >= MAX_RECORD_PCM_BYTES ||
      this.frames.length >= 4096
    ) {
      return this.flush();
    }
    return null;
  }

  flush() {
    const chunk =
      this.hasSpeech && this.frames.length
        ? mergeMeetingAudioFrames(this.frames, this.frames[0].source)
        : null;
    this.frames = [];
    this.hasSpeech = false;
    this.silenceMs = this.durationMs = this.pcmBytes = 0;
    return chunk;
  }
}

// Load one bounded chronological window per model invocation. Total accepted
// storage is separately capped by MEETING_AUDIO_MAX_BYTES/MAX_FRAMES above.
export const FALLBACK_TRANSCRIPTION_WINDOW_MAX_MS = 2 * 60 * 1000;
export const FALLBACK_TRANSCRIPTION_WINDOW_MAX_PCM_BYTES = 4 * 1024 * 1024;

function chunkPcmBuffer(chunk: MeetingFallbackAudioChunk) {
  return Buffer.from(
    chunk.pcm16.buffer,
    chunk.pcm16.byteOffset,
    chunk.pcm16.byteLength
  );
}

function recordBuffer(chunk: MeetingFallbackAudioChunk, speech?: boolean) {
  const pcm = chunkPcmBuffer(chunk);
  const header = Buffer.from(
    JSON.stringify({
      durationMs: chunk.durationMs,
      endMs: chunk.endMs,
      id: chunk.id,
      level: chunk.level,
      pcmBytes: pcm.byteLength,
      sampleRate: chunk.sampleRate,
      source: chunk.source,
      startMs: chunk.startMs,
      speech,
      version: speech === undefined ? 1 : 2,
    } satisfies StoredAudioChunkHeader),
    'utf8'
  );
  if (header.byteLength > MAX_HEADER_BYTES) {
    throw new Error('Meeting fallback audio metadata is too large.');
  }
  const prefix = Buffer.allocUnsafe(HEADER_SIZE_BYTES);
  prefix.writeUInt32LE(header.byteLength, 0);
  return Buffer.concat([prefix, header, pcm]);
}

function splitChunk(chunk: MeetingFallbackAudioChunk) {
  const maxSamples = Math.floor(
    MAX_RECORD_PCM_BYTES / Int16Array.BYTES_PER_ELEMENT
  );
  if (chunk.pcm16.length <= maxSamples && chunk.durationMs <= MAX_RECORD_MS) {
    return [chunk];
  }

  const parts: MeetingFallbackAudioChunk[] = [];
  const totalSamples = chunk.pcm16.length;
  const partCount = Math.max(1, Math.ceil(totalSamples / maxSamples));
  for (let part = 0; part < partCount; part++) {
    const firstSample = Math.floor((totalSamples * part) / partCount);
    const lastSample = Math.floor((totalSamples * (part + 1)) / partCount);
    if (lastSample <= firstSample) {
      continue;
    }
    const startRatio = firstSample / totalSamples;
    const endRatio = lastSample / totalSamples;
    const startMs = Math.round(
      chunk.startMs + (chunk.endMs - chunk.startMs) * startRatio
    );
    const endMs = Math.round(
      chunk.startMs + (chunk.endMs - chunk.startMs) * endRatio
    );
    parts.push({
      ...chunk,
      durationMs: Math.max(0, endMs - startMs),
      endMs,
      id: `${chunk.id}:${part + 1}`,
      pcm16: chunk.pcm16.subarray(firstSample, lastSample),
      startMs,
    });
  }
  return parts;
}

function readHeader(buffer: Buffer): StoredAudioChunkHeader {
  const value = JSON.parse(
    buffer.toString('utf8')
  ) as Partial<StoredAudioChunkHeader>;
  if (
    (value.version !== 1 && value.version !== 2) ||
    (value.version === 2 &&
      (typeof value.speech !== 'boolean' || (value.id?.length ?? 0) > 256)) ||
    typeof value.id !== 'string' ||
    !value.id ||
    (value.source !== 'mic' && value.source !== 'system') ||
    value.sampleRate !== 16000 ||
    !Number.isFinite(value.startMs) ||
    !Number.isFinite(value.endMs) ||
    !Number.isFinite(value.durationMs) ||
    !Number.isFinite(value.level) ||
    !Number.isInteger(value.pcmBytes) ||
    (value.pcmBytes ?? 0) <= 0 ||
    (value.pcmBytes ?? 0) > MAX_RECORD_PCM_BYTES ||
    (value.pcmBytes ?? 0) % Int16Array.BYTES_PER_ELEMENT !== 0
  ) {
    throw new Error('Meeting fallback audio spool contains invalid metadata.');
  }
  return value as StoredAudioChunkHeader;
}

async function readExactly(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number
) {
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const result = await handle.read(
      buffer,
      bytesRead,
      length - bytesRead,
      position + bytesRead
    );
    if (!result.bytesRead) {
      break;
    }
    bytesRead += result.bytesRead;
  }
  if (!bytesRead) {
    return null;
  }
  if (bytesRead !== length) {
    throw new Error('Meeting fallback audio spool ended unexpectedly.');
  }
  return buffer;
}

function pcm16FromBuffer(buffer: Buffer) {
  const result = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < result.length; i++) {
    result[i] = buffer.readInt16LE(i * 2);
  }
  return result;
}

export class MeetingFallbackAudioSpool {
  private discarded = false;
  private operation = Promise.resolve();
  private initialized = false;
  private readonly acceptedIds = new Set<string>();
  private bytes = 0;
  private frameCount = 0;

  constructor(readonly filePath: string) {}

  sourceFilePath(source: MeetingAudioSource) {
    return `${this.filePath}.${source}`;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation);
    this.operation = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  private async syncDirectory(directory: string) {
    // Windows does not support opening directories for fsync.
    if (process.platform === 'win32') return;
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async initialize() {
    if (this.initialized) return;
    this.acceptedIds.clear();
    this.bytes = this.frameCount = 0;
    for (const source of ['mic', 'system'] as const) {
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(this.sourceFilePath(source), 'r+');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      let position = 0;
      try {
        const { size } = await handle.stat();
        while (position < size) {
          // Only an incomplete final record can be repaired automatically.
          // Invalid complete metadata is corruption and must remain visible.
          if (size - position < HEADER_SIZE_BYTES) break;
          const prefix = await readExactly(handle, HEADER_SIZE_BYTES, position);
          if (!prefix) {
            throw new Error('Meeting fallback audio spool ended unexpectedly.');
          }
          const length = prefix.readUInt32LE(0);
          if (!length || length > MAX_HEADER_BYTES) {
            throw new Error(
              'Meeting fallback audio spool contains an invalid record header.'
            );
          }
          if (size - position < HEADER_SIZE_BYTES + length) break;
          const headerBuffer = await readExactly(
            handle,
            length,
            position + HEADER_SIZE_BYTES
          );
          if (!headerBuffer) {
            throw new Error(
              'Meeting fallback audio spool is missing metadata.'
            );
          }
          const header = readHeader(headerBuffer);
          const recordBytes = HEADER_SIZE_BYTES + length + header.pcmBytes;
          if (size - position < recordBytes) break;
          if (header.source !== source) {
            throw new Error(
              'Meeting fallback audio spool contains the wrong source stream.'
            );
          }
          if (header.version === 2) {
            if (++this.frameCount > MEETING_AUDIO_MAX_FRAMES) {
              throw new Error(
                'Meeting audio acceptance journal has too many frames.'
              );
            }
            this.acceptedIds.add(`${source}:${header.id}`);
          }
          position += recordBytes;
        }
        if (position !== size) await handle.truncate(position);
        // A complete record may have survived a crash before its sync/response.
        // Make it durable before treating a retry as already accepted.
        await handle.sync();
        await this.syncDirectory(path.dirname(this.filePath));
        this.bytes += position;
      } finally {
        await handle.close();
      }
    }
    this.initialized = true;
  }

  private async writeRecord(source: MeetingAudioSource, records: Buffer[]) {
    const directory = path.dirname(this.filePath);
    const created = await mkdir(directory, { recursive: true });
    const handle = await open(this.sourceFilePath(source), 'a+');
    const initialSize = (await handle.stat()).size;
    try {
      for (const record of records) await handle.writeFile(record);
      await handle.sync();
      await this.syncDirectory(directory);
      if (created) {
        let parent = directory;
        while (parent !== path.dirname(created)) {
          parent = path.dirname(parent);
          await this.syncDirectory(parent);
        }
      }
    } catch (error) {
      this.initialized = false;
      // A rejected append must not poison the next retry with a torn record.
      await handle.truncate(initialSize);
      await handle.sync();
      throw error;
    } finally {
      await handle.close();
    }
    this.bytes += records.reduce((total, record) => total + record.length, 0);
  }

  accept(frame: MeetingNormalizedAudioFrame, requestId: string | null) {
    // Sync journal data before ACK. End-to-end power-loss recovery also depends
    // on meeting metadata persistence; this alone does not guarantee it.
    return this.serialize(async () => {
      if (this.discarded) throw new Error('Meeting audio spool is closed.');
      await this.initialize();
      const id = requestId ?? randomUUID();
      const key = `${frame.source}:${id}`;
      if (this.acceptedIds.has(key)) return false;
      if (
        !frame.pcm16.length ||
        frame.pcm16.byteLength > MAX_RECORD_PCM_BYTES ||
        !Number.isFinite(frame.durationMs) ||
        frame.durationMs < 0 ||
        frame.durationMs > MAX_RECORD_MS ||
        !id ||
        id.length > 256 ||
        !Number.isFinite(frame.startMs) ||
        !Number.isFinite(frame.endMs) ||
        !Number.isFinite(frame.level) ||
        frame.startMs < 0 ||
        frame.endMs < frame.startMs ||
        frame.sampleRate !== 16000
      ) {
        throw new Error(
          'Meeting audio frames must contain at most 30 seconds of PCM.'
        );
      }
      const record = recordBuffer({ ...frame, id }, frame.speech);
      if (
        this.bytes + record.length > MEETING_AUDIO_MAX_BYTES ||
        this.frameCount >= MEETING_AUDIO_MAX_FRAMES
      ) {
        throw new Error(
          'Meeting audio recovery storage limit reached. Stop and recover this meeting before recording more.'
        );
      }
      await this.writeRecord(frame.source, [record]);
      this.frameCount++;
      this.acceptedIds.add(key);
      return true;
    });
  }

  reopen() {
    return this.serialize(async () => {
      this.discarded = false;
      this.initialized = false;
      await this.initialize();
    });
  }

  append(chunk: MeetingFallbackAudioChunk) {
    if (!chunk.pcm16.length) {
      return Promise.resolve();
    }
    if (this.discarded) {
      return Promise.resolve();
    }
    return this.serialize(async () => {
      if (this.discarded) {
        return;
      }
      await this.initialize();
      await this.writeRecord(
        chunk.source,
        splitChunk(chunk).map(part => recordBuffer(part))
      );
    });
  }

  async hasChunks() {
    await this.serialize(() => this.initialize());
    if (this.discarded) {
      return false;
    }
    const sizes = await Promise.all(
      (['mic', 'system'] satisfies MeetingAudioSource[]).map(source =>
        stat(this.sourceFilePath(source))
          .then(result => result.size)
          .catch(() => 0)
      )
    );
    return sizes.some(size => size > 0);
  }

  private async *sourceChunks(
    source: MeetingAudioSource
  ): AsyncGenerator<MeetingFallbackAudioChunk> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(this.sourceFilePath(source), 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    let position = 0;
    const vad = new MeetingAudioVadBuffer();
    try {
      while (true) {
        const prefix = await readExactly(handle, HEADER_SIZE_BYTES, position);
        if (!prefix) {
          break;
        }
        position += HEADER_SIZE_BYTES;
        const headerLength = prefix.readUInt32LE(0);
        if (!headerLength || headerLength > MAX_HEADER_BYTES) {
          throw new Error(
            'Meeting fallback audio spool contains an invalid record header.'
          );
        }
        const headerBuffer = await readExactly(handle, headerLength, position);
        if (!headerBuffer) {
          throw new Error('Meeting fallback audio spool is missing metadata.');
        }
        position += headerLength;
        const header = readHeader(headerBuffer);
        const pcmBuffer = await readExactly(handle, header.pcmBytes, position);
        if (!pcmBuffer) {
          throw new Error('Meeting fallback audio spool is missing PCM data.');
        }
        position += header.pcmBytes;
        const chunk: MeetingFallbackAudioChunk = {
          durationMs: header.durationMs,
          endMs: header.endMs,
          id: header.id,
          level: header.level,
          pcm16: pcm16FromBuffer(pcmBuffer),
          sampleRate: 16000,
          source: header.source,
          startMs: header.startMs,
        };
        if (chunk.source !== source) {
          throw new Error(
            'Meeting fallback audio spool contains the wrong source stream.'
          );
        }
        if (header.version === 2) {
          if (typeof header.speech !== 'boolean') {
            throw new Error(
              'Meeting fallback audio spool contains invalid metadata.'
            );
          }
          const speechChunk = vad.append({ ...chunk, speech: header.speech });
          if (speechChunk) yield* splitChunk(speechChunk);
        } else {
          const tail = vad.flush();
          if (tail) yield* splitChunk(tail);
          yield chunk;
        }
      }
      const tail = vad.flush();
      if (tail) yield* splitChunk(tail);
    } finally {
      await handle.close();
    }
  }

  async *windows(): AsyncGenerator<MeetingFallbackAudioChunk[]> {
    await this.operation;
    if (this.discarded || !(await this.hasChunks())) {
      return;
    }

    const mic = this.sourceChunks('mic')[Symbol.asyncIterator]();
    const system = this.sourceChunks('system')[Symbol.asyncIterator]();
    let micChunk = await mic.next();
    let systemChunk = await system.next();
    let window: MeetingFallbackAudioChunk[] = [];
    let windowDurationMs = 0;
    let windowPcmBytes = 0;
    try {
      while (!micChunk.done || !systemChunk.done) {
        const useMic =
          systemChunk.done ||
          (!micChunk.done &&
            (micChunk.value.startMs < systemChunk.value.startMs ||
              (micChunk.value.startMs === systemChunk.value.startMs &&
                micChunk.value.endMs <= systemChunk.value.endMs)));
        const chunk = useMic ? micChunk.value : systemChunk.value;
        if (!chunk) {
          break;
        }
        const sourceChanged =
          window.length > 0 && window[0]?.source !== chunk.source;
        const durationExceeded =
          window.length > 0 &&
          windowDurationMs + chunk.durationMs >
            FALLBACK_TRANSCRIPTION_WINDOW_MAX_MS;
        const bytesExceeded =
          window.length > 0 &&
          windowPcmBytes + chunk.pcm16.byteLength >
            FALLBACK_TRANSCRIPTION_WINDOW_MAX_PCM_BYTES;
        if (
          sourceChanged ||
          durationExceeded ||
          bytesExceeded ||
          window.length >= 256
        ) {
          yield window;
          window = [];
          windowDurationMs = 0;
          windowPcmBytes = 0;
        }
        window.push(chunk);
        windowDurationMs += chunk.durationMs;
        windowPcmBytes += chunk.pcm16.byteLength;
        if (useMic) {
          micChunk = await mic.next();
        } else {
          systemChunk = await system.next();
        }
      }
      if (window.length) {
        yield window;
      }
    } finally {
      await mic.return?.(undefined);
      await system.return?.(undefined);
    }
  }

  discard() {
    return this.serialize(async () => {
      await Promise.all([
        rm(this.filePath, { force: true }),
        rm(this.sourceFilePath('mic'), { force: true }),
        rm(this.sourceFilePath('system'), { force: true }),
      ]);
      this.discarded = true;
      this.acceptedIds.clear();
    });
  }
}
