import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MicAudioSpoolStore } from '../../src/main/recording/mic-audio-spool';

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-mic-spool-'));
  temporaryDirectories.push(directory);
  return directory;
}

function pcmBytes(samples: number[]) {
  const pcm = new Float32Array(samples);
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('microphone audio disk spool', () => {
  it('keeps a prolonged offline backlog on disk and replays one bounded stable frame', async () => {
    const directory = temporaryDirectory();
    const spool = new MicAudioSpoolStore(directory);
    await spool.open({
      channels: 1,
      meetingId: 'offline-meeting',
      sampleRate: 1000,
      startMs: 250,
    });

    const batch = pcmBytes(Array.from({ length: 250 }, (_, index) => index));
    for (let index = 0; index < 240; index += 1) {
      await spool.append('offline-meeting', batch);
    }

    const offlineStatus = await spool.status('offline-meeting');
    expect(offlineStatus.pendingBytes).toBe(240 * batch.byteLength);

    const firstAttempt = await spool.readFrame('offline-meeting', 4096);
    expect(firstAttempt?.buffer.byteLength).toBeLessThanOrEqual(4096);

    // More captured audio can reach disk while the backend response is lost.
    await spool.append('offline-meeting', pcmBytes([999, 1000]));
    const retry = await spool.readFrame('offline-meeting', 4096);
    expect(retry).toEqual(firstAttempt);

    // A replacement renderer/main-side client reloads the persisted in-flight
    // boundary instead of producing a larger, duplicate-overlapping frame.
    const reloaded = new MicAudioSpoolStore(directory);
    const replayAfterReload = await reloaded.readFrame('offline-meeting', 4096);
    expect(replayAfterReload).toEqual(firstAttempt);
  });

  it('acknowledges exact frames in order and removes only a fully drained spool', async () => {
    const directory = temporaryDirectory();
    const spool = new MicAudioSpoolStore(directory);
    await spool.open({
      channels: 1,
      meetingId: 'drained-meeting',
      sampleRate: 1000,
      startMs: 100,
    });
    await spool.append('drained-meeting', pcmBytes([1, 2, 3, 4, 5, 6]));

    const first = await spool.readFrame('drained-meeting', 16);
    expect(first).toMatchObject({
      endBytes: 16,
      endMs: 104,
      frameId: 'mic:0:16',
      startBytes: 0,
      startMs: 100,
    });
    await expect(
      spool.acknowledge('drained-meeting', 'mic:0:20')
    ).rejects.toThrow('expected acknowledgement');
    await spool.acknowledge('drained-meeting', first?.frameId ?? '');

    const second = await spool.readFrame('drained-meeting', 16);
    expect(second).toMatchObject({
      endBytes: 24,
      frameId: 'mic:16:24',
      startBytes: 16,
    });
    await spool.acknowledge('drained-meeting', second?.frameId ?? '');
    await spool.close('drained-meeting');
    const closedStatus = await spool.status('drained-meeting');
    expect(closedStatus).toMatchObject({ closed: true, pendingBytes: 0 });

    // A failed or interrupted export must not delete the only complete mic
    // archive. It remains readable for a deterministic retry.
    await expect(spool.finish('drained-meeting')).rejects.toThrow(
      'cannot be deleted before its portable recording is published'
    );
    const preserved = await spool.readArchive('drained-meeting', 0, 64);
    expect(preserved.buffer).toEqual(Buffer.from(pcmBytes([1, 2, 3, 4, 5, 6])));
    expect(preserved.nextCursor).toBe(24);

    const publishedPath = await spool.publishPortable(
      'drained-meeting',
      new Uint8Array([1, 2, 3])
    );
    expect(path.basename(publishedPath)).toMatch(
      /^meeting-[a-f0-9]+-microphone\.opus$/
    );
    await expect(spool.finish('drained-meeting')).resolves.toBe(true);
    // Finalization can be replayed after a renderer/backend retry without
    // turning an already removed spool into a new failure.
    await expect(spool.finish('drained-meeting')).resolves.toBe(false);
    await expect(spool.close('drained-meeting')).resolves.toBe(false);
    await expect(spool.status('drained-meeting')).rejects.toThrow('not found');
  });

  it('persists a renderer-reload wall-clock gap as a new audio segment', async () => {
    const directory = temporaryDirectory();
    const firstRenderer = new MicAudioSpoolStore(directory);
    await firstRenderer.open({
      channels: 1,
      meetingId: 'reloaded-meeting',
      sampleRate: 1000,
      startMs: 100,
    });
    await firstRenderer.append('reloaded-meeting', pcmBytes([1, 2, 3, 4]));
    await firstRenderer.close('reloaded-meeting');

    const secondRenderer = new MicAudioSpoolStore(directory);
    await secondRenderer.open({
      channels: 1,
      meetingId: 'reloaded-meeting',
      sampleRate: 1000,
      startMs: 1000,
    });
    await secondRenderer.append('reloaded-meeting', pcmBytes([5, 6, 7, 8]));

    // A read cannot cross a persisted segment boundary, even when its byte
    // budget could hold both sides of the renderer gap.
    const beforeReload = await secondRenderer.readFrame('reloaded-meeting', 64);
    expect(beforeReload).toMatchObject({
      endBytes: 16,
      endMs: 104,
      frameId: 'mic:0:16',
      startBytes: 0,
      startMs: 100,
    });
    await secondRenderer.acknowledge(
      'reloaded-meeting',
      beforeReload?.frameId ?? ''
    );

    const afterReload = await secondRenderer.readFrame('reloaded-meeting', 64);
    expect(afterReload).toMatchObject({
      endBytes: 32,
      endMs: 1004,
      frameId: 'mic:16:32',
      startBytes: 16,
      startMs: 1000,
    });
  });
});
