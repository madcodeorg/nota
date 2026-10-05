import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { RawRecordingArchive } from '../../src/main/recording/raw-recording-archive';

class FakeWriteStream extends EventEmitter {
  readonly writes: Buffer[] = [];
  returnBackpressure = false;

  destroy(error?: Error) {
    if (error) {
      this.emit('error', error);
    }
    return this;
  }

  end() {
    this.emit('finish');
    return this;
  }

  write(buffer: Buffer) {
    this.writes.push(Buffer.from(buffer));
    return !this.returnBackpressure;
  }
}

describe('raw recording archive', () => {
  it('handles an injected mid-recording disk error for the whole stream lifetime', async () => {
    const stream = new FakeWriteStream();
    const onFailure = vi.fn(() => {
      throw new Error('failure observer also failed');
    });
    const archive = new RawRecordingArchive(stream as never, { onFailure });

    archive.write(new Float32Array([0.1, 0.2]));
    const diskError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    expect(() => stream.emit('error', diskError)).not.toThrow();

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(diskError);
    expect(() => archive.write(new Float32Array([0.3]))).toThrow('disk full');
    await expect(archive.end()).rejects.toThrow('disk full');
  });

  it('queues only a bounded amount during backpressure and flushes in order', async () => {
    const stream = new FakeWriteStream();
    stream.returnBackpressure = true;
    const onFailure = vi.fn();
    const archive = new RawRecordingArchive(stream as never, {
      maxPendingBytes: 16,
      onFailure,
    });

    archive.write(new Float32Array([1, 2]));
    archive.write(new Float32Array([3, 4]));
    archive.write(new Float32Array([5, 6]));
    expect(archive.bytesAccepted).toBe(24);

    stream.returnBackpressure = false;
    stream.emit('drain');
    await archive.end();

    expect(onFailure).not.toHaveBeenCalled();
    expect(
      stream.writes.flatMap(buffer => [
        ...new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
        ),
      ])
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('fails capture instead of growing past the backpressure bound', () => {
    const stream = new FakeWriteStream();
    stream.returnBackpressure = true;
    const onFailure = vi.fn();
    const archive = new RawRecordingArchive(stream as never, {
      maxPendingBytes: 8,
      onFailure,
    });

    archive.write(new Float32Array([1, 2]));
    archive.write(new Float32Array([3, 4]));
    expect(() => archive.write(new Float32Array([5, 6]))).toThrow(
      'could not keep up'
    );
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
