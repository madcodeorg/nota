import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  FALLBACK_TRANSCRIPTION_WINDOW_MAX_MS,
  FALLBACK_TRANSCRIPTION_WINDOW_MAX_PCM_BYTES,
  type MeetingFallbackAudioChunk,
  MeetingFallbackAudioSpool,
  type MeetingNormalizedAudioFrame,
} from './meeting-audio-spool.js';

const temporaryDirectories: string[] = [];

async function temporarySpool() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nota-stt-spool-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'meetings', 'meeting-1.spool');
  return {
    filePath,
    spool: new MeetingFallbackAudioSpool(filePath),
  };
}

function chunk(input: {
  endMs: number;
  id: string;
  source?: 'mic' | 'system';
  startMs: number;
}): MeetingFallbackAudioChunk {
  return {
    durationMs: input.endMs - input.startMs,
    endMs: input.endMs,
    id: input.id,
    level: 0.2,
    pcm16: new Int16Array([100]),
    sampleRate: 16000,
    source: input.source ?? 'mic',
    startMs: input.startMs,
  };
}

function frame(
  startMs = 0,
  source: 'mic' | 'system' = 'mic'
): MeetingNormalizedAudioFrame {
  return {
    ...chunk({ id: 'unused', startMs, endMs: startMs + 500, source }),
    pcm16: new Int16Array(8000).fill(6553),
    speech: true,
  };
}

async function chunks(spool: MeetingFallbackAudioSpool) {
  const result: MeetingFallbackAudioChunk[] = [];
  for await (const window of spool.windows()) result.push(...window);
  return result;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

describe('MeetingFallbackAudioSpool', () => {
  test('recovers a stopped speech tail and deduplicates concurrent and restarted retries', async () => {
    const { spool, filePath } = await temporarySpool();
    expect(
      await Promise.all([
        spool.accept(frame(), 'mic:0:32000'),
        spool.accept(frame(), 'mic:0:32000'),
      ])
    ).toEqual([true, false]);
    const recovered = new MeetingFallbackAudioSpool(filePath);
    expect(await recovered.accept(frame(), 'mic:0:32000')).toBe(false);
    const result = await chunks(recovered);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: 'mic', startMs: 0, endMs: 500 });
    expect(result[0].pcm16).toEqual(frame().pcm16);
    // IDs are scoped to source; simultaneous system audio is not suppressed.
    expect(await recovered.accept(frame(0, 'system'), 'mic:0:32000')).toBe(
      true
    );
    expect((await chunks(recovered)).map(item => item.source)).toEqual([
      'mic',
      'system',
    ]);
  });

  test.each(['prefix', 'header', 'pcm'] as const)(
    'repairs only a torn final %s and appends a retry after the committed prefix',
    async stage => {
      const { spool, filePath } = await temporarySpool();
      await spool.accept(frame(), 'first');
      const committed = await readFile(spool.sourceFilePath('mic'));
      const headerLength = committed.readUInt32LE(0);
      const length =
        stage === 'prefix' ? 2 : stage === 'header' ? 6 : 4 + headerLength + 20;
      await appendFile(
        spool.sourceFilePath('mic'),
        committed.subarray(0, length)
      );
      const recovered = new MeetingFallbackAudioSpool(filePath);
      expect(await recovered.accept(frame(500), 'second')).toBe(true);
      expect(await recovered.accept(frame(), 'first')).toBe(false);
      const result = await chunks(recovered);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ startMs: 0, endMs: 1000 });
      expect(result[0].pcm16.length).toBe(16000);
      expect((await stat(spool.sourceFilePath('mic'))).size).toBeLessThan(
        committed.length * 2 + 100
      );
    }
  );

  test('does not treat complete corrupt metadata as a repairable crash tail', async () => {
    const { spool, filePath } = await temporarySpool();
    await spool.accept(frame(), 'first');
    const corrupt = Buffer.alloc(4);
    corrupt.writeUInt32LE(20000);
    await appendFile(spool.sourceFilePath('mic'), corrupt);
    const size = (await stat(spool.sourceFilePath('mic'))).size;
    await expect(
      new MeetingFallbackAudioSpool(filePath).accept(frame(500), 'second')
    ).rejects.toThrow('invalid record header');
    expect((await stat(spool.sourceFilePath('mic'))).size).toBe(size);
  });

  test('rejects an unavailable journal without accepting the ID and permits retry', async () => {
    const { spool } = await temporarySpool();
    await mkdir(spool.sourceFilePath('mic'), { recursive: true });
    await expect(spool.accept(frame(), 'retry')).rejects.toThrow();
    await rm(spool.sourceFilePath('mic'), { recursive: true });
    expect(await spool.accept(frame(), 'retry')).toBe(true);
    expect((await chunks(spool))[0].pcm16).toEqual(frame().pcm16);
  });

  test('bounds continuous speech windows and preserves short speech at stop', async () => {
    const { spool } = await temporarySpool();
    for (let index = 0; index < 70; index++) {
      await spool.accept(frame(index * 500), `frame-${index}`);
    }
    const result = await chunks(spool);
    expect(result.map(item => item.durationMs)).toEqual([30000, 5000]);
    expect(result.reduce((sum, item) => sum + item.pcm16.length, 0)).toBe(
      70 * 8000
    );
    await spool.discard();
    await expect(spool.accept(frame(), 'closed')).rejects.toThrow('closed');
    await spool.reopen();
    await spool.accept(
      {
        ...frame(),
        durationMs: 100,
        endMs: 100,
        pcm16: new Int16Array(1600).fill(10),
      },
      'short'
    );
    expect((await chunks(spool))[0]).toMatchObject({ startMs: 0, endMs: 100 });
  });

  test('rejects oversized frames instead of silently dropping or retaining unbounded PCM', async () => {
    const { spool } = await temporarySpool();
    await expect(
      spool.accept({ ...frame(), durationMs: 30001 }, 'large')
    ).rejects.toThrow('at most 30 seconds');
    expect(await spool.hasChunks()).toBe(false);
  });

  test('reads legacy completed chunks alongside new accepted frames', async () => {
    const { spool, filePath } = await temporarySpool();
    await spool.append(chunk({ id: 'legacy', startMs: 0, endMs: 500 }));
    await spool.accept(frame(500), 'new');
    const result = await chunks(new MeetingFallbackAudioSpool(filePath));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'legacy', startMs: 0, endMs: 500 });
    expect(result[1]).toMatchObject({ startMs: 500, endMs: 1000 });
  });

  test('preserves more than 30 minutes while loading only bounded windows', async () => {
    const { filePath, spool } = await temporarySpool();
    const logicalChunkCount = 61;
    await Promise.all(
      Array.from({ length: logicalChunkCount }, (_, index) =>
        spool.append(
          chunk({
            endMs: (index + 1) * 30_000,
            id: `chunk-${index}`,
            startMs: index * 30_000,
          })
        )
      )
    );

    // A new runtime can recover the same disk-backed spool after restart.
    const recovered = new MeetingFallbackAudioSpool(filePath);
    const windows: MeetingFallbackAudioChunk[][] = [];
    for await (const window of recovered.windows()) {
      windows.push(window);
    }

    const recoveredChunks = windows.flat();
    expect(recoveredChunks).toHaveLength(logicalChunkCount);
    expect(recoveredChunks[0]).toMatchObject({
      id: 'chunk-0',
      startMs: 0,
    });
    expect(recoveredChunks.at(-1)).toMatchObject({
      endMs: 31 * 60_000 - 30_000,
      id: 'chunk-60',
    });
    expect(
      recoveredChunks.reduce((total, item) => total + item.durationMs, 0)
    ).toBe(30 * 60_000 + 30_000);
    for (const window of windows) {
      expect(
        window.reduce((total, item) => total + item.durationMs, 0)
      ).toBeLessThanOrEqual(FALLBACK_TRANSCRIPTION_WINDOW_MAX_MS);
      expect(
        window.reduce((total, item) => total + item.pcm16.byteLength, 0)
      ).toBeLessThanOrEqual(FALLBACK_TRANSCRIPTION_WINDOW_MAX_PCM_BYTES);
    }
  });

  test('keeps source and timestamp boundaries when replaying chronologically', async () => {
    const { spool } = await temporarySpool();
    // System VAD can complete before an earlier microphone utterance. The two
    // source files must still merge by meeting timestamp, not append order.
    await spool.append(
      chunk({
        endMs: 2_000,
        id: 'system-1',
        source: 'system',
        startMs: 1_000,
      })
    );
    await spool.append(chunk({ endMs: 1_000, id: 'mic-1', startMs: 0 }));
    await spool.append(chunk({ endMs: 3_000, id: 'mic-2', startMs: 2_000 }));

    const windows: MeetingFallbackAudioChunk[][] = [];
    for await (const window of spool.windows()) {
      windows.push(window);
    }

    expect(windows.map(window => window.map(item => item.id))).toEqual([
      ['mic-1'],
      ['system-1'],
      ['mic-2'],
    ]);
    expect(windows.map(window => window[0]?.source)).toEqual([
      'mic',
      'system',
      'mic',
    ]);
    expect(windows.flat().map(item => [item.startMs, item.endMs])).toEqual([
      [0, 1_000],
      [1_000, 2_000],
      [2_000, 3_000],
    ]);
  });

  test('removes the spool only when discard is explicitly confirmed', async () => {
    const { spool } = await temporarySpool();
    const filePath = spool.sourceFilePath('mic');
    await spool.append(chunk({ endMs: 1_000, id: 'kept', startMs: 0 }));
    await expect(access(filePath)).resolves.toBeUndefined();

    await spool.discard();
    await expect(access(filePath)).rejects.toThrow();

    await spool.append(chunk({ endMs: 2_000, id: 'late', startMs: 1_000 }));
    await expect(access(filePath)).rejects.toThrow();
  });
});
