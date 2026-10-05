import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createMeetingSileroVad,
  resolveMeetingVadAsset,
  verifyMeetingVadFile,
} from './meeting-vad';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe('meeting Silero wrapper', () => {
  test('carries the previous 64 samples and recurrent state across packet boundaries', async () => {
    const inputs: Float32Array[] = [];
    const states: Float32Array[] = [];
    const nextState = new Float32Array(256).fill(1);
    const vad = createMeetingSileroVad({
      infer: async (pcm, state) => {
        inputs.push(pcm);
        states.push(state);
        return { probability: 0.8, state: nextState };
      },
      onFailure: vi.fn(),
    });
    await expect(vad.push(new Int16Array(200).fill(1000))).resolves.toBeNull();
    await expect(vad.push(new Int16Array(312).fill(2000))).resolves.toBe(0.8);
    await vad.push(new Int16Array(512).fill(-3000));
    expect(inputs.map(pcm => pcm.length)).toEqual([576, 576]);
    expect([...inputs[0].subarray(0, 64)]).toEqual(
      Array.from({ length: 64 }, () => 0)
    );
    expect(inputs[0][64]).toBeCloseTo(1000 / 32767);
    expect(inputs[0][264]).toBeCloseTo(2000 / 32767);
    expect([...inputs[1].subarray(0, 64)]).toEqual([
      ...inputs[0].subarray(-64),
    ]);
    expect(inputs[1][64]).toBeCloseTo(-3000 / 32768);
    expect(states[1]).toBe(nextState);
  });

  test('falls back visibly once on inference failure', async () => {
    const onFailure = vi.fn();
    const infer = vi.fn(async () => {
      throw new Error('broken VAD');
    });
    const vad = createMeetingSileroVad({ infer, onFailure });
    await expect(vad.push(new Int16Array(1600))).resolves.toBeNull();
    await expect(vad.push(new Int16Array(1600))).resolves.toBeNull();
    expect(infer).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  test('rejects invalid model output rather than interpreting it as silence', async () => {
    const onFailure = vi.fn();
    const vad = createMeetingSileroVad({
      infer: async () => ({
        probability: Number.NaN,
        state: new Float32Array(256),
      }),
      onFailure,
    });
    await expect(vad.push(new Int16Array(512))).resolves.toBeNull();
    expect(onFailure).toHaveBeenCalledOnce();
  });
});

describe('shared speech detector asset', () => {
  test('missing assets never cause network requests during live startup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-vad-'));
    temporary.push(root);
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no downloads'));
    await expect(resolveMeetingVadAsset(root, [])).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('rejects corrupt installed files and mock downloads before promotion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nota-vad-'));
    temporary.push(root);
    await writeFile(path.join(root, 'silero_vad.onnx'), 'invalid');
    await expect(
      verifyMeetingVadFile(path.join(root, 'silero_vad.onnx'))
    ).resolves.toBe(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('invalid', { status: 200 })
    );
    await expect(resolveMeetingVadAsset(root, [root], true)).rejects.toThrow(
      'checksum verification failed'
    );
    await expect(resolveMeetingVadAsset(root, [])).resolves.toBeNull();
  });
});
