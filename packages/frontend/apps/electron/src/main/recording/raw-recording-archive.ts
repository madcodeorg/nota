import type { WriteStream } from 'node:fs';

const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;

type RawArchiveStream = Pick<
  WriteStream,
  'destroy' | 'end' | 'on' | 'once' | 'write'
>;

type RawRecordingArchiveOptions = {
  maxPendingBytes?: number;
  onFailure: (error: Error) => void;
};

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * A bounded queue in front of the raw recording WriteStream.
 *
 * Native audio taps cannot be paused. Once Node reports backpressure, later
 * tap buffers stay in this explicitly bounded queue until `drain`; a disk
 * failure or a queue that cannot catch up fails capture deterministically.
 */
export class RawRecordingArchive {
  private backpressured = false;
  private endPromise: Promise<void> | null = null;
  private endReject: ((error: Error) => void) | null = null;
  private endResolve: (() => void) | null = null;
  private ending = false;
  private failure: Error | null = null;
  private finished = false;
  private readonly maxPendingBytes: number;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private streamEnded = false;

  bytesAccepted = 0;

  constructor(
    private readonly stream: RawArchiveStream,
    private readonly options: RawRecordingArchiveOptions
  ) {
    this.maxPendingBytes = Math.max(
      1,
      Math.floor(options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES)
    );
    // Keep this listener installed for the entire stream lifetime. Attaching
    // only inside stop() leaves mid-recording ENOSPC/EIO as an unhandled event.
    stream.on('error', this.handleError);
    stream.on('drain', this.handleDrain);
    stream.once('close', this.handleClose);
    stream.once('finish', this.handleFinish);
  }

  get error() {
    return this.failure;
  }

  write(samples: Float32Array) {
    if (this.ending) {
      throw new Error('Cannot write to a closing recording archive.');
    }
    if (this.failure) {
      throw this.failure;
    }

    // Copy the native view: the native binding owns its ArrayBuffer and may
    // reuse it before a backpressured disk write is eventually flushed.
    const source = new Uint8Array(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength
    );
    const buffer = Buffer.from(source);

    if (this.backpressured) {
      if (this.pendingBytes + buffer.byteLength > this.maxPendingBytes) {
        const error = new Error(
          `Recording archive could not keep up with audio capture (${this.pendingBytes} queued bytes).`
        );
        this.fail(error);
        this.stream.destroy(error);
        throw error;
      }
      this.pending.push(buffer);
      this.pendingBytes += buffer.byteLength;
      this.bytesAccepted += buffer.byteLength;
      return;
    }

    this.writeBuffer(buffer);
  }

  end() {
    if (this.endPromise) {
      return this.endPromise;
    }
    this.ending = true;
    this.endPromise = new Promise<void>((resolve, reject) => {
      this.endResolve = resolve;
      this.endReject = reject;
      if (this.failure) {
        reject(this.failure);
        return;
      }
      if (this.finished) {
        resolve();
        return;
      }
      this.flushPending();
    });
    return this.endPromise;
  }

  private readonly handleDrain = () => {
    if (this.failure || this.finished) {
      return;
    }
    this.backpressured = false;
    this.flushPending();
  };

  private readonly handleError = (error: unknown) => {
    this.fail(normalizeError(error));
  };

  private readonly handleClose = () => {
    if (!this.finished && !this.failure) {
      this.fail(new Error('Recording archive closed before it finished.'));
    }
  };

  private readonly handleFinish = () => {
    this.finished = true;
    this.endResolve?.();
  };

  private writeBuffer(buffer: Buffer) {
    try {
      const writable = this.stream.write(buffer);
      this.bytesAccepted += buffer.byteLength;
      this.backpressured = !writable;
    } catch (error) {
      const normalized = normalizeError(error);
      this.fail(normalized);
      throw normalized;
    }
  }

  private flushPending() {
    while (!this.backpressured && this.pending.length && !this.failure) {
      const buffer = this.pending.shift();
      if (!buffer) {
        break;
      }
      this.pendingBytes -= buffer.byteLength;
      // It was counted when accepted into the explicit queue.
      const before = this.bytesAccepted;
      this.writeBuffer(buffer);
      this.bytesAccepted = before;
    }

    if (
      this.ending &&
      !this.failure &&
      !this.backpressured &&
      !this.pending.length &&
      !this.streamEnded
    ) {
      this.streamEnded = true;
      this.stream.end();
    }
  }

  private fail(error: Error) {
    if (this.failure) {
      return;
    }
    this.failure = error;
    this.pending = [];
    this.pendingBytes = 0;
    try {
      this.options.onFailure(error);
    } catch {
      // The lifetime error listener must never turn a disk error back into an
      // unhandled EventEmitter exception. The original failure stays stored.
    }
    this.endReject?.(error);
  }
}
