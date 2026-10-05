import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const JOURNAL_VERSION = 1;

type BeginEvent = {
  meetingId: string;
  rawPath: string;
  recordingId: number;
  startTime: number;
  type: 'begin';
  version: typeof JOURNAL_VERSION;
  workspaceId: string;
};

type FormatEvent = {
  channels: number;
  sampleRate: number;
  type: 'format';
};

type StoppedEvent = {
  archiveBytes: number;
  type: 'stopped';
};

type ReadyEvent = {
  filepath: string;
  type: 'ready';
};

type RecoveryEvent = BeginEvent | FormatEvent | ReadyEvent | StoppedEvent;

export type BeginSystemAudioRecoveryInput = Omit<
  BeginEvent,
  'type' | 'version'
>;

export type RecoveredSystemAudioRecording = {
  archiveBytes: number;
  filepath: string;
  meetingId: string;
  numberOfChannels: number | null;
  rawPath: string;
  recordingId: number;
  sampleRate: number | null;
  startTime: number;
  status: 'ready' | 'stopped';
  workspaceId: string;
};

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

export class SystemAudioRecoveryJournal {
  constructor(
    private readonly directory: string,
    private readonly recordingsDirectory: string
  ) {}

  begin(input: BeginSystemAudioRecoveryInput) {
    if (
      !nonEmptyString(input.meetingId) ||
      !nonEmptyString(input.workspaceId) ||
      !nonNegativeInteger(input.recordingId) ||
      !nonNegativeInteger(input.startTime)
    ) {
      throw new Error('System audio recovery ownership is invalid.');
    }
    const rawPath = this.assertRecordingPath(input.rawPath);
    fs.mkdirSync(this.directory, { recursive: true });
    const journalPath = this.journalPath(input.meetingId);
    const existing = this.readJournal(journalPath);
    if (existing) {
      if (
        existing.meetingId !== input.meetingId ||
        existing.workspaceId !== input.workspaceId ||
        existing.recordingId !== input.recordingId ||
        existing.rawPath !== rawPath
      ) {
        throw new Error('System audio recovery ownership already exists.');
      }
      return existing;
    }

    const event: BeginEvent = {
      meetingId: input.meetingId.trim(),
      rawPath,
      recordingId: input.recordingId,
      startTime: input.startTime,
      type: 'begin',
      version: JOURNAL_VERSION,
      workspaceId: input.workspaceId.trim(),
    };
    this.writeInitialEvent(journalPath, event);
    return this.readJournal(journalPath);
  }

  updateFormat(
    recordingId: number,
    channels: number,
    sampleRate: number,
    startTime?: number
  ) {
    if (!positiveInteger(channels) || !positiveInteger(sampleRate)) {
      throw new Error('System audio recovery format is invalid.');
    }
    const journal = this.findByRecordingId(recordingId, startTime);
    if (!journal) {
      return false;
    }
    this.appendEvent(this.journalPath(journal.meetingId), {
      channels,
      sampleRate,
      type: 'format',
    });
    return true;
  }

  markStopped(recordingId: number, archiveBytes: number, startTime?: number) {
    if (!nonNegativeInteger(archiveBytes)) {
      throw new Error('System audio recovery archive size is invalid.');
    }
    const journal = this.findByRecordingId(recordingId, startTime);
    if (!journal) {
      return false;
    }
    this.appendEvent(this.journalPath(journal.meetingId), {
      archiveBytes,
      type: 'stopped',
    });
    return true;
  }

  async publishPortable(
    recordingId: number,
    encoded: Uint8Array,
    startTime?: number
  ) {
    if (!encoded.byteLength) {
      throw new Error('Recovered system audio encoding must not be empty.');
    }
    const journal = this.findByRecordingId(recordingId, startTime);
    if (!journal) {
      return null;
    }
    if (!journal.numberOfChannels || !journal.sampleRate) {
      throw new Error(
        'Recovered system audio is missing its native audio format.'
      );
    }
    const rawPath = this.assertRecordingPath(journal.rawPath);
    const filepath = this.assertRecordingPath(
      rawPath.replace(/\.raw$/i, '.opus')
    );
    const existing = await fsp.stat(filepath).catch(() => null);
    if (!existing?.isFile() || existing.size <= 0) {
      const temporary = `${filepath}.${process.pid}.${Date.now()}.tmp`;
      const file = await fsp.open(temporary, 'wx');
      try {
        await file.writeFile(encoded);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await fsp.rename(temporary, filepath);
      } finally {
        await fsp.rm(temporary, { force: true }).catch(() => {});
      }
    }
    this.appendEvent(this.journalPath(journal.meetingId), {
      filepath,
      type: 'ready',
    });
    // Publication is idempotent across both crash windows: after rename but
    // before `ready`, and after `ready` but before raw cleanup.
    await fsp.rm(rawPath, { force: true });
    return filepath;
  }

  release(recordingId: number, meetingId?: string) {
    const journal = meetingId
      ? this.findByMeetingId(meetingId)
      : this.findByRecordingId(recordingId);
    if (!journal) {
      return false;
    }
    if (journal.recordingId !== recordingId) {
      throw new Error('System audio recovery ownership does not match.');
    }
    if (journal.status !== 'ready') {
      throw new Error(
        'System audio recovery cannot be released before portable publication.'
      );
    }
    const portable = this.fileStats(journal.filepath);
    if (!portable?.isFile() || portable.size <= 0) {
      throw new Error('System audio recovery portable recording is missing.');
    }
    if (journal.rawPath !== journal.filepath) {
      fs.rmSync(journal.rawPath, { force: true });
    }
    fs.rmSync(this.journalPath(journal.meetingId), { force: true });
    return true;
  }

  findByMeetingId(meetingId: string) {
    return this.readJournal(this.journalPath(meetingId));
  }

  findByRecordingId(recordingId: number, startTime?: number) {
    return (
      this.all()
        .filter(
          journal =>
            journal.recordingId === recordingId &&
            (startTime === undefined || journal.startTime === startTime)
        )
        .sort((first, second) => second.startTime - first.startTime)[0] ?? null
    );
  }

  latest() {
    return (
      this.all().sort(
        (first, second) => second.startTime - first.startTime
      )[0] ?? null
    );
  }

  private all() {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return entries
      .filter(entry => entry.endsWith('.jsonl'))
      .map(entry => this.readJournal(path.join(this.directory, entry)))
      .filter(
        (journal): journal is RecoveredSystemAudioRecording => journal !== null
      );
  }

  private readJournal(journalPath: string) {
    let raw: string;
    try {
      raw = fs.readFileSync(journalPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    const events = raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as RecoveryEvent;
        } catch {
          // A process can die in the middle of the final append. Every prior
          // fsynced line remains authoritative.
          return null;
        }
      })
      .filter((event): event is RecoveryEvent => event !== null);
    const begin = events.find(event => event.type === 'begin');
    if (
      !begin ||
      begin.version !== JOURNAL_VERSION ||
      !nonEmptyString(begin.meetingId) ||
      !nonEmptyString(begin.workspaceId) ||
      !nonNegativeInteger(begin.recordingId) ||
      !nonNegativeInteger(begin.startTime)
    ) {
      return null;
    }

    let filepath: string;
    try {
      filepath = this.assertRecordingPath(begin.rawPath);
    } catch {
      return null;
    }
    let numberOfChannels: number | null = null;
    let sampleRate: number | null = null;
    let archiveBytes = 0;
    for (const event of events) {
      if (
        event.type === 'format' &&
        positiveInteger(event.channels) &&
        positiveInteger(event.sampleRate)
      ) {
        numberOfChannels = event.channels;
        sampleRate = event.sampleRate;
      } else if (
        event.type === 'stopped' &&
        nonNegativeInteger(event.archiveBytes)
      ) {
        archiveBytes = event.archiveBytes;
      } else if (event.type === 'ready' && nonEmptyString(event.filepath)) {
        try {
          filepath = this.assertRecordingPath(event.filepath);
        } catch {
          return null;
        }
      }
    }

    const derivedPortable = this.assertRecordingPath(
      begin.rawPath.replace(/\.raw$/i, '.opus')
    );
    const portableStats = this.fileStats(
      /\.raw$/i.test(filepath) ? derivedPortable : filepath
    );
    if (portableStats?.isFile() && portableStats.size > 0) {
      filepath = /\.raw$/i.test(filepath) ? derivedPortable : filepath;
    } else {
      const rawStats = this.fileStats(begin.rawPath);
      if (!rawStats?.isFile()) {
        return null;
      }
      filepath = this.assertRecordingPath(begin.rawPath);
      archiveBytes = Math.max(archiveBytes, rawStats.size);
    }

    return {
      archiveBytes,
      filepath,
      meetingId: begin.meetingId,
      numberOfChannels,
      rawPath: this.assertRecordingPath(begin.rawPath),
      recordingId: begin.recordingId,
      sampleRate,
      startTime: begin.startTime,
      status: /\.raw$/i.test(filepath) ? 'stopped' : 'ready',
      workspaceId: begin.workspaceId,
    } satisfies RecoveredSystemAudioRecording;
  }

  private writeInitialEvent(journalPath: string, event: RecoveryEvent) {
    const file = fs.openSync(journalPath, 'wx');
    try {
      fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(file);
    } finally {
      fs.closeSync(file);
    }
    this.syncDirectory();
  }

  private appendEvent(journalPath: string, event: RecoveryEvent) {
    const file = fs.openSync(journalPath, 'a');
    try {
      fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(file);
    } finally {
      fs.closeSync(file);
    }
  }

  private syncDirectory() {
    try {
      const directory = fs.openSync(this.directory, 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    } catch {
      // Directory fsync is unavailable on some Windows filesystems. The file
      // itself was fsynced before capture starts.
    }
  }

  private journalPath(meetingId: string) {
    const basename = createHash('sha256').update(meetingId).digest('hex');
    return path.join(this.directory, `${basename}.jsonl`);
  }

  private assertRecordingPath(filepath: string) {
    const normalized = path.normalize(filepath);
    const base = path.normalize(`${this.recordingsDirectory}${path.sep}`);
    if (!normalized.toLowerCase().startsWith(base.toLowerCase())) {
      throw new Error('System audio recovery path is outside recordings.');
    }
    return normalized;
  }

  private fileStats(filepath: string) {
    try {
      return fs.statSync(filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
