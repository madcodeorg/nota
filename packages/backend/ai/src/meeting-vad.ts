import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MeetingSpeechDetector } from './meeting-capture-pipeline';

export const MEETING_VAD_SHA256 =
  'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808';
const VAD_URL =
  'https://huggingface.co/onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4/resolve/8364d9e2dd9da23789b480bdbba9e423717e42ee/silero_vad.onnx';
const assetJobs = new Map<string, Promise<string | null>>();

function verified(bytes: Uint8Array) {
  return (
    createHash('sha256').update(bytes).digest('hex') === MEETING_VAD_SHA256
  );
}

export async function verifyMeetingVadFile(file: string) {
  try {
    return verified(await readFile(file));
  } catch {
    return false;
  }
}

// Provisioned during an STT download/seed preparation, never downloaded in the
// live capture path. Legacy/seeded copies migrate into one small shared asset.
export async function resolveMeetingVadAsset(
  workspaceRoot: string,
  modelRoots: string[],
  download = false
): Promise<string | null> {
  const target = path.join(
    workspaceRoot,
    '.nota',
    'models',
    'shared',
    'silero_vad.onnx'
  );
  const pending = assetJobs.get(target);
  if (pending) {
    const result = await pending;
    if (result || !download) return result;
    return resolveMeetingVadAsset(workspaceRoot, modelRoots, download);
  }
  const job = (async () => {
    if (await verifyMeetingVadFile(target)) return target;
    let bytes: Uint8Array | null = null;
    for (const root of modelRoots) {
      try {
        const candidate = await readFile(path.join(root, 'silero_vad.onnx'));
        if (verified(candidate)) {
          bytes = candidate;
          break;
        }
      } catch {
        /* Try the next installed model. */
      }
    }
    if (!bytes && download) {
      const response = await fetch(VAD_URL, {
        headers: { 'User-Agent': 'NotaAIBackend/0.1' },
      });
      if (!response.ok)
        throw new Error(
          `Speech detector download failed (${response.status}).`
        );
      bytes = new Uint8Array(await response.arrayBuffer());
      if (!verified(bytes))
        throw new Error('Speech detector checksum verification failed.');
    }
    if (!bytes) return null;
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes);
      // Windows does not replace an existing destination during rename.
      await unlink(target).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return target;
  })();
  assetJobs.set(target, job);
  try {
    return await job;
  } finally {
    assetJobs.delete(target);
  }
}

// Silero's official 16 kHz wrapper feeds 512 new samples plus the previous 64
// samples of context. The recurrent state alone does not replace this context.
export function createMeetingSileroVad(input: {
  infer: (
    samples: Float32Array,
    state: Float32Array
  ) => Promise<{
    probability: number;
    state: Float32Array;
  }>;
  onFailure: (error: unknown) => void;
}): MeetingSpeechDetector {
  let state: Float32Array = new Float32Array(2 * 128);
  let context = new Float32Array(64);
  let pending = new Float32Array(0);
  let failed = false;
  return {
    get failed() {
      return failed;
    },
    async push(pcm) {
      if (failed) return null;
      const merged = new Float32Array(pending.length + pcm.length);
      merged.set(pending);
      for (let i = 0; i < pcm.length; i++) {
        merged[pending.length + i] = pcm[i] / (pcm[i] < 0 ? 32768 : 32767);
      }
      let probability: number | null = null;
      try {
        let offset = 0;
        while (merged.length - offset >= 512) {
          const samples = new Float32Array(576);
          samples.set(context);
          samples.set(merged.subarray(offset, offset + 512), 64);
          const result = await input.infer(samples, state);
          if (
            !Number.isFinite(result.probability) ||
            result.state.length !== 256
          ) {
            throw new Error('Speech detector returned invalid output.');
          }
          state = result.state;
          context = samples.slice(-64);
          probability = Math.max(probability ?? 0, result.probability);
          offset += 512;
        }
        pending = merged.slice(offset);
      } catch (error) {
        failed = true;
        pending = new Float32Array(0);
        input.onFailure(error);
        return null;
      }
      return probability;
    },
  };
}
