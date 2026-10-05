import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
import {
  closeNativeAsrWorkers,
  createNativeAsrDecoder,
  encodeNativeAsrRequest,
  isNativeAsrCached,
  preloadNativeAsr,
} from './native-asr';

function helper(autoReady = true, autoReply = true) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  const requests: Buffer[] = [];
  child.stdin.on('data', (frame: Buffer) => {
    requests.push(frame);
    if (autoReply)
      queueMicrotask(() =>
        child.stdout.write(
          JSON.stringify({
            text: `phrase ${requests.length}`,
            language: 'en',
          }) + '\n'
        )
      );
  });
  if (autoReady) queueMicrotask(() => child.stdout.write('{"ready":true}\n'));
  return { child, requests };
}
const original = process.env.NOTA_WHISTLE_HELPER_PATH;
beforeEach(() => {
  process.env.NOTA_WHISTLE_HELPER_PATH = fileURLToPath(import.meta.url);
  spawn.mockReset();
});
afterEach(() => {
  closeNativeAsrWorkers();
  vi.useRealTimers();
  if (original === undefined) delete process.env.NOTA_WHISTLE_HELPER_PATH;
  else process.env.NOTA_WHISTLE_HELPER_PATH = original;
});

describe('persistent native ASR adapter', () => {
  test('encodes little-endian PCM and rejects oversized helper input', () => {
    const frame = encodeNativeAsrRequest(
      new Int16Array([-32768, 42, 32767]),
      'fr'
    );
    expect(frame.readUInt32LE(0)).toBe(3);
    expect(frame.readUInt16LE(4)).toBe(2);
    expect(frame.subarray(6, 8).toString()).toBe('fr');
    expect([
      frame.readInt16LE(8),
      frame.readInt16LE(10),
      frame.readInt16LE(12),
    ]).toEqual([-32768, 42, 32767]);
    expect(() =>
      encodeNativeAsrRequest(new Int16Array(31 * 16000), 'auto')
    ).toThrow('30 seconds');
  });

  test('shares a model, serializes concurrent decoders and snapshots their languages', async () => {
    const mock = helper(true, false);
    spawn.mockReturnValue(mock.child);
    const [a, b] = await Promise.all([
      createNativeAsrDecoder('cactus-needle', '/test/model', 'fr'),
      createNativeAsrDecoder('cactus-needle', '/test/model', 'de'),
    ]);
    a.pushPcm16(new Int16Array([1, 2]));
    b.pushPcm16(new Int16Array([3]));
    const first = a.finish();
    const second = b.finish();
    await vi.waitFor(() => expect(mock.requests).toHaveLength(1));
    mock.child.stdout.write('{"text":" bonjour ","language":"fr"}\n');
    await expect(first).resolves.toEqual({ text: 'bonjour', language: 'fr' });
    await vi.waitFor(() => expect(mock.requests).toHaveLength(2));
    mock.child.stdout.write('{"text":"hallo","language":"de"}\n');
    await expect(second).resolves.toEqual({ text: 'hallo', language: 'de' });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(mock.requests.map(frame => frame.subarray(6, 8).toString())).toEqual(
      ['fr', 'de']
    );
  });

  test('transcribes all 45 seconds through bounded requests and reuses the loaded model', async () => {
    const mock = helper();
    spawn.mockReturnValue(mock.child);
    const decoder = await createNativeAsrDecoder(
      'cactus-needle',
      '/test/model'
    );
    decoder.pushPcm16(new Int16Array(45 * 16000).fill(123));
    expect(await decoder.finish()).toEqual({
      text: 'phrase 1 phrase 2 phrase 3',
      language: 'en',
    });
    expect(mock.requests.map(frame => frame.readUInt32LE(0))).toEqual([
      20 * 16000,
      20 * 16000,
      5 * 16000,
    ]);
    decoder.pushPcm16(new Int16Array([42]));
    expect((await decoder.finish()).text).toBe('phrase 4');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(decoder.supportsPartials).toBe(false);
  });

  test('unloads the previous idle model when a different size is loaded', async () => {
    const previous = helper();
    spawn.mockReturnValue(previous.child);
    await preloadNativeAsr('cactus-needle', '/test/previous');
    const selected = helper();
    spawn.mockReturnValue(selected.child);
    await preloadNativeAsr('cactus-needle', '/test/selected');
    expect(previous.child.kill).toHaveBeenCalledOnce();
    expect(selected.child.kill).not.toHaveBeenCalled();
    expect(isNativeAsrCached('cactus-needle', '/test/previous')).toBe(false);
  });

  test('propagates helper failure and retries with a fresh process', async () => {
    const mock = helper(true, false);
    spawn.mockReturnValue(mock.child);
    const decoder = await createNativeAsrDecoder(
      'cactus-needle',
      '/test/model'
    );
    decoder.pushPcm16(new Int16Array([1]));
    const pending = decoder.finish();
    const rejected = expect(pending).rejects.toThrow('bad model');
    await vi.waitFor(() => expect(mock.requests).toHaveLength(1));
    mock.child.stdout.write('{"error":"bad model"}\n');
    await rejected;
    expect(mock.child.kill).toHaveBeenCalledOnce();
    expect(isNativeAsrCached('cactus-needle', '/test/model')).toBe(false);
    spawn.mockReturnValue(helper().child);
    await preloadNativeAsr('cactus-needle', '/test/model');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('shutdown kills helpers synchronously and rejects in-flight requests', async () => {
    const mock = helper(true, false);
    spawn.mockReturnValue(mock.child);
    const decoder = await createNativeAsrDecoder(
      'cactus-needle',
      '/test/model'
    );
    decoder.pushPcm16(new Int16Array([1]));
    const rejected = expect(decoder.finish()).rejects.toThrow('closed');
    await vi.waitFor(() => expect(mock.requests).toHaveLength(1));
    closeNativeAsrWorkers();
    expect(mock.child.kill).toHaveBeenCalledOnce();
    await rejected;
  });

  test('times out stuck loading and unloads an idle model after 60 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stuck = helper(false);
    spawn.mockReturnValue(stuck.child);
    const rejection = expect(
      preloadNativeAsr('cactus-needle', '/stuck')
    ).rejects.toThrow('load timed out');
    await vi.advanceTimersByTimeAsync(120000);
    await rejection;
    expect(stuck.child.kill).toHaveBeenCalledOnce();
    const idle = helper();
    spawn.mockReturnValue(idle.child);
    await preloadNativeAsr('cactus-needle', '/idle');
    await vi.advanceTimersByTimeAsync(60000);
    expect(idle.child.kill).toHaveBeenCalledOnce();
    expect(isNativeAsrCached('cactus-needle', '/idle')).toBe(false);
  });

  test('times out a stuck decode and rejects unexpected process exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const mock = helper(true, false);
    spawn.mockReturnValue(mock.child);
    const decoder = await createNativeAsrDecoder('cactus-needle', '/decode');
    decoder.pushPcm16(new Int16Array([1]));
    const rejection = expect(decoder.finish()).rejects.toThrow(
      'decode timed out'
    );
    const queuedDecoder = await createNativeAsrDecoder(
      'cactus-needle',
      '/decode'
    );
    queuedDecoder.pushPcm16(new Int16Array([2]));
    const queuedRejection = expect(queuedDecoder.finish()).rejects.toThrow(
      'closed'
    );
    await vi.advanceTimersByTimeAsync(120000);
    await rejection;
    await queuedRejection;
    const exited = helper(false);
    spawn.mockReturnValue(exited.child);
    const failure = expect(
      preloadNativeAsr('cactus-needle', '/exit')
    ).rejects.toThrow('exited (7)');
    exited.child.emit('exit', 7, null);
    await failure;
  });
});
