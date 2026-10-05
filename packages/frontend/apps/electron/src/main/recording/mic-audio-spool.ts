import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const JOURNAL_VERSION = 2;
const MAX_APPEND_BYTES = 512 * 1024;

type MicAudioSpoolSegment = {
  startBytes: number;
  startMs: number;
};

type MicAudioSpoolJournal = {
  acknowledgedBytes: number;
  channels: number;
  closed: boolean;
  inflightEndBytes: number | null;
  meetingId: string;
  sampleRate: number;
  segments: MicAudioSpoolSegment[];
  startMs: number;
  version: typeof JOURNAL_VERSION;
};

type LegacyMicAudioSpoolJournal = Omit<
  MicAudioSpoolJournal,
  'segments' | 'version'
> & {
  version: 1;
};

export type OpenMicAudioSpoolInput = {
  channels: number;
  meetingId: string;
  sampleRate: number;
  startMs: number;
};

export type MicAudioSpoolFrame = {
  buffer: Buffer;
  endBytes: number;
  endMs: number;
  frameId: string;
  startBytes: number;
  startMs: number;
};

export type MicAudioSpoolStatus = {
  acknowledgedBytes: number;
  archiveBytes: number;
  channels: number;
  closed: boolean;
  pendingBytes: number;
  sampleRate: number;
};

export type MicAudioSpoolArchiveChunk = {
  buffer: Buffer;
  nextCursor: number;
};

function validPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function validNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function journalBaseMatches(
  value: unknown
): value is MicAudioSpoolJournal | LegacyMicAudioSpoolJournal {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const journal = value as Partial<MicAudioSpoolJournal>;
  const version = (value as { version?: number }).version;
  return (
    (version === 1 || version === JOURNAL_VERSION) &&
    typeof journal.meetingId === 'string' &&
    Number.isSafeInteger(journal.channels) &&
    (journal.channels ?? 0) > 0 &&
    Number.isSafeInteger(journal.sampleRate) &&
    (journal.sampleRate ?? 0) > 0 &&
    Number.isSafeInteger(journal.startMs) &&
    (journal.startMs ?? -1) >= 0 &&
    Number.isSafeInteger(journal.acknowledgedBytes) &&
    (journal.acknowledgedBytes ?? -1) >= 0 &&
    (journal.inflightEndBytes === null ||
      (Number.isSafeInteger(journal.inflightEndBytes) &&
        (journal.inflightEndBytes ?? -1) >= 0)) &&
    typeof journal.closed === 'boolean'
  );
}

function segmentMatches(value: unknown): value is MicAudioSpoolSegment {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const segment = value as Partial<MicAudioSpoolSegment>;
  return (
    Number.isSafeInteger(segment.startBytes) &&
    (segment.startBytes ?? -1) >= 0 &&
    Number.isSafeInteger(segment.startMs) &&
    (segment.startMs ?? -1) >= 0
  );
}

function normalizeJournal(value: unknown): MicAudioSpoolJournal | null {
  if (!journalBaseMatches(value)) {
    return null;
  }
  if (value.version === 1) {
    return {
      ...value,
      segments: [{ startBytes: 0, startMs: value.startMs }],
      version: JOURNAL_VERSION,
    };
  }
  if (
    !Array.isArray(value.segments) ||
    !value.segments.length ||
    !value.segments.every(segmentMatches) ||
    value.segments[0]?.startBytes !== 0
  ) {
    return null;
  }
  for (let index = 1; index < value.segments.length; index += 1) {
    const previous = value.segments[index - 1];
    const current = value.segments[index];
    if (
      !previous ||
      !current ||
      current.startBytes <= previous.startBytes ||
      current.startMs < previous.startMs
    ) {
      return null;
    }
  }
  return value;
}

export class MicAudioSpoolStore {
  private readonly operations = new Map<string, Promise<unknown>>();
  private journalWriteId = 0;

  constructor(private readonly directory: string) {}

  open(input: OpenMicAudioSpoolInput) {
    const meetingId = input.meetingId.trim();
    if (!meetingId) {
      throw new Error('meetingId is required.');
    }
    const channels = validPositiveInteger(input.channels, 'channels');
    const sampleRate = validPositiveInteger(input.sampleRate, 'sampleRate');
    const startMs = validNonNegativeInteger(input.startMs, 'startMs');

    return this.serialized(meetingId, async () => {
      await fsp.mkdir(this.directory, { recursive: true });
      const existing = await this.readJournal(meetingId);
      if (existing) {
        if (
          existing.channels !== channels ||
          existing.sampleRate !== sampleRate
        ) {
          throw new Error(
            `Microphone spool format changed from ${existing.sampleRate} Hz/${existing.channels} channel(s) to ${sampleRate} Hz/${channels} channel(s).`
          );
        }
        await this.repairJournalAgainstArchive(existing);
        const archiveBytes = await this.archiveBytes(meetingId);
        this.recordReopenSegment(existing, archiveBytes, startMs);
        existing.closed = false;
        await this.writeJournal(existing);
        return this.statusFor(existing);
      }

      const journal: MicAudioSpoolJournal = {
        acknowledgedBytes: 0,
        channels,
        closed: false,
        inflightEndBytes: null,
        meetingId,
        sampleRate,
        segments: [{ startBytes: 0, startMs }],
        startMs,
        version: JOURNAL_VERSION,
      };
      const rawPath = this.rawPath(meetingId);
      try {
        await fsp.writeFile(rawPath, Buffer.alloc(0), { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        const orphanedBytes = (await fsp.stat(rawPath)).size;
        if (orphanedBytes !== 0) {
          throw new Error(
            'An unjournaled microphone spool already contains audio. It was preserved for recovery.'
          );
        }
      }
      await this.writeJournal(journal);
      return this.statusFor(journal);
    });
  }

  append(meetingId: string, pcm: Uint8Array) {
    if (pcm.byteLength > MAX_APPEND_BYTES) {
      return Promise.reject(
        new Error(`Microphone PCM append exceeds ${MAX_APPEND_BYTES} bytes.`)
      );
    }
    const copy = Buffer.from(pcm);
    return this.serialized(meetingId, async () => {
      const journal = await this.requireJournal(meetingId);
      if (journal.closed) {
        throw new Error('Microphone spool is already closed.');
      }
      const frameBytes = this.frameBytes(journal);
      if (!copy.byteLength || copy.byteLength % frameBytes !== 0) {
        throw new Error(
          `Microphone PCM must contain complete ${frameBytes}-byte audio frames.`
        );
      }
      await fsp.appendFile(this.rawPath(meetingId), copy);
      return this.statusFor(journal);
    });
  }

  readFrame(meetingId: string, maximumBytes: number) {
    return this.serialized(meetingId, async () => {
      const journal = await this.requireJournal(meetingId);
      await this.repairJournalAgainstArchive(journal);
      const archiveBytes = await this.archiveBytes(meetingId);
      const frameBytes = this.frameBytes(journal);
      const boundedBytes =
        Math.floor(
          Math.min(
            validPositiveInteger(maximumBytes, 'maximumBytes'),
            MAX_APPEND_BYTES
          ) / frameBytes
        ) * frameBytes;
      if (!boundedBytes) {
        throw new Error(
          `maximumBytes must hold at least one ${frameBytes}-byte audio frame.`
        );
      }

      if (journal.acknowledgedBytes === archiveBytes) {
        return null;
      }

      const startBytes = journal.acknowledgedBytes;
      const segmentIndex = this.segmentIndexForCursor(journal, startBytes);
      const segment = journal.segments[segmentIndex];
      const nextSegmentStart = journal.segments[segmentIndex + 1]?.startBytes;
      const endBytes =
        journal.inflightEndBytes ??
        Math.min(
          archiveBytes,
          startBytes + boundedBytes,
          nextSegmentStart ?? Number.POSITIVE_INFINITY
        );
      if (endBytes <= startBytes || endBytes > archiveBytes) {
        throw new Error(
          'Microphone spool journal has an invalid frame boundary.'
        );
      }

      if (journal.inflightEndBytes === null) {
        journal.inflightEndBytes = endBytes;
        // Persist the exact boundary before exposing bytes. If a response is
        // lost or the renderer crashes, the same frame id and payload replay.
        await this.writeJournal(journal);
      }

      const buffer = Buffer.alloc(endBytes - startBytes);
      const file = await fsp.open(this.rawPath(meetingId), 'r');
      try {
        let bytesRead = 0;
        while (bytesRead < buffer.byteLength) {
          const result = await file.read(
            buffer,
            bytesRead,
            buffer.byteLength - bytesRead,
            startBytes + bytesRead
          );
          if (!result.bytesRead) {
            break;
          }
          bytesRead += result.bytesRead;
        }
        if (bytesRead !== buffer.byteLength) {
          throw new Error(
            `Microphone spool frame read ${bytesRead} of ${buffer.byteLength} bytes.`
          );
        }
      } finally {
        await file.close();
      }

      return {
        buffer,
        endBytes,
        endMs: this.cursorToMs(journal, endBytes, segment),
        frameId: `mic:${startBytes}:${endBytes}`,
        startBytes,
        startMs: this.cursorToMs(journal, startBytes, segment),
      } satisfies MicAudioSpoolFrame;
    });
  }

  acknowledge(meetingId: string, frameId: string) {
    return this.serialized(meetingId, async () => {
      const journal = await this.requireJournal(meetingId);
      const endBytes = journal.inflightEndBytes;
      if (endBytes === null) {
        throw new Error(
          'Microphone spool has no frame awaiting acknowledgement.'
        );
      }
      const expectedFrameId = `mic:${journal.acknowledgedBytes}:${endBytes}`;
      if (frameId !== expectedFrameId) {
        throw new Error(
          `Microphone spool expected acknowledgement for ${expectedFrameId}.`
        );
      }
      journal.acknowledgedBytes = endBytes;
      journal.inflightEndBytes = null;
      await this.writeJournal(journal);
      return this.statusFor(journal);
    });
  }

  close(meetingId: string) {
    return this.serialized(meetingId, async () => {
      const journal = await this.readJournal(meetingId);
      if (!journal) {
        return false;
      }
      journal.closed = true;
      await this.writeJournal(journal);
      return this.statusFor(journal);
    });
  }

  finish(meetingId: string) {
    return this.serialized(meetingId, async () => {
      const journal = await this.readJournal(meetingId);
      if (!journal) {
        return false;
      }
      const status = await this.statusFor(journal);
      if (!journal.closed || status.pendingBytes !== 0) {
        throw new Error(
          `Microphone spool still has ${status.pendingBytes} unacknowledged bytes.`
        );
      }
      if (
        status.archiveBytes > 0 &&
        !(await this.publishedPortablePath(meetingId))
      ) {
        throw new Error(
          'Microphone spool cannot be deleted before its portable recording is published.'
        );
      }
      await Promise.all([
        fsp.rm(this.rawPath(meetingId), { force: true }),
        fsp.rm(this.journalPath(meetingId), { force: true }),
      ]);
      return true;
    });
  }

  status(meetingId: string) {
    return this.serialized(meetingId, async () => {
      const journal = await this.requireJournal(meetingId);
      await this.repairJournalAgainstArchive(journal);
      return this.statusFor(journal);
    });
  }

  readArchive(meetingId: string, cursor: number, maximumBytes: number) {
    return this.serialized(meetingId, async () => {
      const journal = await this.requireJournal(meetingId);
      await this.repairJournalAgainstArchive(journal);
      const archiveBytes = await this.archiveBytes(meetingId);
      const frameBytes = this.frameBytes(journal);
      const start = validNonNegativeInteger(cursor, 'cursor');
      if (start > archiveBytes || start % frameBytes !== 0) {
        throw new Error('Microphone archive cursor is invalid.');
      }
      const boundedBytes =
        Math.floor(
          Math.min(
            validPositiveInteger(maximumBytes, 'maximumBytes'),
            MAX_APPEND_BYTES
          ) / frameBytes
        ) * frameBytes;
      if (!boundedBytes) {
        throw new Error(
          `maximumBytes must hold at least one ${frameBytes}-byte audio frame.`
        );
      }
      const end = Math.min(archiveBytes, start + boundedBytes);
      if (end === start) {
        return {
          buffer: Buffer.alloc(0),
          nextCursor: start,
        } satisfies MicAudioSpoolArchiveChunk;
      }
      const buffer = Buffer.allocUnsafe(end - start);
      const file = await fsp.open(this.rawPath(meetingId), 'r');
      try {
        let bytesRead = 0;
        while (bytesRead < buffer.byteLength) {
          const result = await file.read(
            buffer,
            bytesRead,
            buffer.byteLength - bytesRead,
            start + bytesRead
          );
          if (!result.bytesRead) {
            break;
          }
          bytesRead += result.bytesRead;
        }
        if (bytesRead !== buffer.byteLength) {
          throw new Error(
            `Microphone archive read ${bytesRead} of ${buffer.byteLength} bytes.`
          );
        }
      } finally {
        await file.close();
      }
      return {
        buffer,
        nextCursor: end,
      } satisfies MicAudioSpoolArchiveChunk;
    });
  }

  publishedPortablePath(meetingId: string) {
    const filepath = this.portablePath(meetingId);
    return fsp
      .stat(filepath)
      .then(stats => (stats.isFile() && stats.size > 0 ? filepath : null))
      .catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      });
  }

  publishPortable(meetingId: string, encoded: Uint8Array) {
    const copy = Buffer.from(encoded);
    if (!copy.byteLength) {
      return Promise.reject(
        new Error('Portable microphone recording must not be empty.')
      );
    }
    return this.serialized(meetingId, async () => {
      const journal = await this.requireJournal(meetingId);
      await this.repairJournalAgainstArchive(journal);
      const status = await this.statusFor(journal);
      if (!journal.closed || status.pendingBytes !== 0) {
        throw new Error(
          `Microphone spool still has ${status.pendingBytes} unacknowledged bytes.`
        );
      }

      await fsp.mkdir(this.directory, { recursive: true });
      const target = this.portablePath(meetingId);
      const temporary = `${target}.${process.pid}.${this.journalWriteId++}.tmp`;
      await fsp.writeFile(temporary, copy);
      try {
        await fsp.rename(temporary, target);
      } catch (error) {
        if (
          !['EEXIST', 'EPERM'].includes(
            (error as NodeJS.ErrnoException).code ?? ''
          )
        ) {
          throw error;
        }
        await fsp.rm(target, { force: true });
        await fsp.rename(temporary, target);
      } finally {
        await fsp.rm(temporary, { force: true }).catch(() => {});
      }
      return target;
    });
  }

  private serialized<T>(meetingId: string, operation: () => Promise<T>) {
    const key = meetingId.trim();
    if (!key) {
      return Promise.reject(new Error('meetingId is required.'));
    }
    const previous = this.operations.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    this.operations.set(
      key,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }

  private async requireJournal(meetingId: string) {
    const journal = await this.readJournal(meetingId);
    if (!journal) {
      throw new Error(
        `Microphone spool for meeting ${meetingId} was not found.`
      );
    }
    return journal;
  }

  private async readJournal(meetingId: string) {
    try {
      const raw = await fsp.readFile(this.journalPath(meetingId), 'utf8');
      const parsed = normalizeJournal(JSON.parse(raw));
      if (!parsed || parsed.meetingId !== meetingId) {
        throw new Error('Microphone spool journal is invalid.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async writeJournal(journal: MicAudioSpoolJournal) {
    await fsp.mkdir(this.directory, { recursive: true });
    const target = this.journalPath(journal.meetingId);
    const temporary = `${target}.${process.pid}.${this.journalWriteId++}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(journal));
    try {
      await fsp.rename(temporary, target);
    } catch (error) {
      if (
        !['EEXIST', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? ''
        )
      ) {
        throw error;
      }
      await fsp.rm(target, { force: true });
      await fsp.rename(temporary, target);
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }

  private async repairJournalAgainstArchive(journal: MicAudioSpoolJournal) {
    const archiveBytes = await this.archiveBytes(journal.meetingId);
    const frameBytes = this.frameBytes(journal);
    if (archiveBytes % frameBytes !== 0) {
      throw new Error(
        'Microphone spool archive ends on a partial audio frame.'
      );
    }
    if (
      journal.segments.some(
        segment =>
          segment.startBytes % frameBytes !== 0 ||
          segment.startBytes > archiveBytes
      )
    ) {
      throw new Error('Microphone spool timeline exceeds its archive.');
    }
    if (journal.acknowledgedBytes > archiveBytes) {
      throw new Error('Microphone spool acknowledgement exceeds its archive.');
    }
    if (
      journal.inflightEndBytes !== null &&
      (journal.inflightEndBytes <= journal.acknowledgedBytes ||
        journal.inflightEndBytes > archiveBytes)
    ) {
      throw new Error('Microphone spool in-flight frame exceeds its archive.');
    }
  }

  private async statusFor(
    journal: MicAudioSpoolJournal
  ): Promise<MicAudioSpoolStatus> {
    const archiveBytes = await this.archiveBytes(journal.meetingId);
    return {
      acknowledgedBytes: journal.acknowledgedBytes,
      archiveBytes,
      channels: journal.channels,
      closed: journal.closed,
      pendingBytes: archiveBytes - journal.acknowledgedBytes,
      sampleRate: journal.sampleRate,
    };
  }

  private async archiveBytes(meetingId: string) {
    return (await fsp.stat(this.rawPath(meetingId))).size;
  }

  private frameBytes(journal: MicAudioSpoolJournal) {
    return Float32Array.BYTES_PER_ELEMENT * journal.channels;
  }

  private cursorToMs(
    journal: MicAudioSpoolJournal,
    cursor: number,
    segment = journal.segments[this.segmentIndexForCursor(journal, cursor)]
  ) {
    if (!segment) {
      throw new Error('Microphone spool timeline is empty.');
    }
    return (
      segment.startMs +
      Math.round(
        ((cursor - segment.startBytes) /
          this.frameBytes(journal) /
          journal.sampleRate) *
          1000
      )
    );
  }

  private segmentIndexForCursor(journal: MicAudioSpoolJournal, cursor: number) {
    for (let index = journal.segments.length - 1; index >= 0; index -= 1) {
      if ((journal.segments[index]?.startBytes ?? 0) <= cursor) {
        return index;
      }
    }
    return 0;
  }

  private recordReopenSegment(
    journal: MicAudioSpoolJournal,
    archiveBytes: number,
    requestedStartMs: number
  ) {
    const previousSegment = journal.segments.at(-1);
    if (!previousSegment) {
      throw new Error('Microphone spool timeline is empty.');
    }
    const previousEndMs = this.cursorToMs(
      journal,
      archiveBytes,
      previousSegment
    );
    const startMs = Math.max(requestedStartMs, previousEndMs);
    if (previousSegment.startBytes === archiveBytes) {
      previousSegment.startMs = Math.max(previousSegment.startMs, startMs);
      return;
    }
    journal.segments.push({ startBytes: archiveBytes, startMs });
  }

  private basename(meetingId: string) {
    return createHash('sha256').update(meetingId).digest('hex');
  }

  private rawPath(meetingId: string) {
    return path.join(this.directory, `${this.basename(meetingId)}.f32le`);
  }

  private journalPath(meetingId: string) {
    return path.join(this.directory, `${this.basename(meetingId)}.json`);
  }

  private portablePath(meetingId: string) {
    return path.join(
      this.directory,
      `meeting-${this.basename(meetingId).slice(0, 16)}-microphone.opus`
    );
  }
}
