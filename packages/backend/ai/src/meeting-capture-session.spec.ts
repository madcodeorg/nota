import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { requiredFilesFor } from './model-registry';
import { createServer } from './server';
import * as sherpa from './sherpa-stt';

let root = '';
let release: (() => void) | undefined;
let server:
  | ReturnType<ReturnType<typeof createServer>['app']['listen']>
  | undefined;

afterEach(async () => {
  release?.();
  if (server)
    await new Promise<void>(resolve => server!.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

test('durably acknowledges audio and deduplicates retries while streaming decode is blocked, then drains on stop', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-capture-session-'));
  vi.stubEnv('NOTA_AI_WORKSPACE_ROOT', root);
  vi.stubEnv(
    'NOTA_AI_SETTINGS_PATH',
    path.join(root, '.nota/ai-settings.json')
  );
  vi.stubEnv('NOTA_AI_BACKEND_TOKEN', 'capture-session-test');
  vi.stubEnv('NOTA_AI_SEEDED_MODEL_ROOT', path.join(root, 'no-seeds'));
  const modelId = 'sherpa-nemotron-3.5-streaming-560ms-int8';
  const modelRoot = path.join(root, '.nota/models', modelId);
  await mkdir(modelRoot, { recursive: true });
  for (const name of requiredFilesFor(modelId))
    await writeFile(path.join(modelRoot, name), 'fixture');
  vi.spyOn(sherpa, 'sherpaRuntimeAvailable').mockResolvedValue(true);
  vi.spyOn(sherpa, 'preloadSherpaRecognizer').mockResolvedValue(undefined);
  let entered!: () => void;
  const decoding = new Promise<void>(resolve => {
    entered = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let totalSamples = 0;
  const finish = vi.fn(async () => ({
    language: null,
    text: 'complete meeting phrase',
  }));
  const partial = vi.fn(async () => {
    entered();
    await gate;
    return `heard ${totalSamples}`;
  });
  vi.spyOn(sherpa, 'createSherpaUtteranceDecoder').mockResolvedValue({
    executionProvider: 'mock/cpu',
    supportsPartials: true,
    pushPcm16(pcm) {
      totalSamples += pcm.length;
    },
    partial,
    finish,
  });
  server = createServer().app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test address');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, init?: RequestInit) =>
    fetch(`${base}${url}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-nota-backend-token': 'capture-session-test',
        ...init?.headers,
      },
    });
  const started = await request('/v1/meetings/start', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: 'pipeline-test',
      sttProviderId: 'nemotron-sherpa',
    }),
  });
  expect(started.status).toBe(200);
  const id = (await started.json()).meeting.id as string;
  function post(startMs: number, durationMs: number) {
    // Capture at the real device rate; the selected decoder must receive mono
    // 16 kHz even when a stereo 48 kHz input packet is used.
    const samples = Float32Array.from(
      { length: durationMs * 48 * 2 },
      (_, i) =>
        0.05 * Math.cos((2 * Math.PI * 1000 * Math.floor(i / 2)) / 48000)
    );
    return request(
      `/v1/meetings/${id}/audio-frame?${new URLSearchParams({ source: 'mic', channels: '2', sampleRate: '48000', startMs: String(startMs), endMs: String(startMs + durationMs), frameId: `mic:${startMs}` })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: samples.buffer,
      }
    );
  }
  expect((await post(0, 200)).status).toBe(200);
  await decoding;
  const second = await post(200, 100);
  expect(second.status).toBe(200);
  const duplicate = await post(0, 200);
  expect(await duplicate.json()).toMatchObject({
    duplicate: true,
    audioFrames: 2,
  });
  const live = await (await request(`/v1/meetings/${id}`)).json();
  expect(live.meeting.stt.pipeline).toMatchObject({
    windowMs: 100,
    sourceWaitMs: 200,
    queuedAudioMs: 300,
    vadMode: 'energy',
  });
  release!();
  expect(
    (await request(`/v1/meetings/${id}/stop`, { method: 'POST', body: '{}' }))
      .status
  ).toBe(200);
  const transcript = await (
    await request(`/v1/meetings/${id}/transcript`)
  ).json();
  expect(transcript.transcriptSegments).toEqual([
    expect.objectContaining({
      startMs: 0,
      endMs: 300,
      text: 'complete meeting phrase',
    }),
  ]);
  expect(totalSamples).toBe(300 * 16);
  expect(partial).toHaveBeenCalledTimes(3);
  expect(finish).toHaveBeenCalledOnce();
  expect(transcript.meeting.stt.pipeline.queuedAudioMs).toBe(0);
});
