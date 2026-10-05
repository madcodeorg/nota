import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const io = vi.hoisted(() => ({
  failSync: false,
  failWrite: false,
  entered: null as (() => void) | null,
  gate: null as Promise<void> | null,
}));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]).includes('.spool.')) {
        const writeFile = handle.writeFile.bind(handle);
        handle.writeFile = async (...writeArgs) => {
          if (io.failWrite) {
            io.failWrite = false;
            await writeFile(
              Buffer.from(writeArgs[0] as Buffer).subarray(0, 30)
            );
            throw new Error('injected partial audio write failure');
          }
          return writeFile(...writeArgs);
        };
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          io.entered?.();
          await io.gate;
          if (io.failSync) {
            io.failSync = false;
            throw new Error('injected audio fsync failure');
          }
          return sync();
        };
      }
      return handle;
    },
  };
});

import { MeetingFallbackAudioSpool } from './meeting-audio-spool.js';
import { createServer } from './server.js';

const TOKEN = 'audio-acceptance-test';
let workspaceRoot = '';
let baseUrl = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;
const children: ChildProcess[] = [];
let releaseGate: (() => void) | undefined;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nota-audio-acceptance-')
  );
  vi.stubEnv('NOTA_AI_BACKEND_TOKEN', TOKEN);
  vi.stubEnv('NOTA_AI_WORKSPACE_ROOT', workspaceRoot);
  vi.stubEnv(
    'NOTA_AI_SETTINGS_PATH',
    path.join(workspaceRoot, '.nota', 'ai-settings.json')
  );
  vi.stubEnv(
    'NOTA_AI_SEEDED_MODEL_ROOT',
    path.join(workspaceRoot, 'missing-seeds')
  );
  io.failSync = false;
  io.failWrite = false;
  io.entered = null;
  io.gate = null;
  const { app } = createServer();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

async function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

afterEach(async () => {
  releaseGate?.();
  releaseGate = undefined;
  io.entered = null;
  io.gate = null;
  await Promise.all(children.splice(0).map(kill));
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  await rm(workspaceRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function request(url: string, init?: RequestInit) {
  return fetch(`${baseUrl}${url}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-nota-backend-token': TOKEN,
      ...init?.headers,
    },
  });
}

async function reserve() {
  const response = await request('/v1/meetings/reserve', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: 'acceptance-test' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).meeting.id as string;
}

function postFrame(
  id: string,
  startMs = 0,
  speech = true,
  frameId = `mic:${startMs}`
) {
  const samples = new Float32Array(8000).fill(speech ? 0.2 : 0);
  return request(
    `/v1/meetings/${id}/audio-frame?${new URLSearchParams({
      source: 'mic',
      channels: '1',
      sampleRate: '16000',
      startMs: String(startMs),
      endMs: String(startMs + 500),
      frameId,
    })}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: samples.buffer,
    }
  );
}

function spool(id: string) {
  return new MeetingFallbackAudioSpool(
    path.join(
      workspaceRoot,
      '.nota',
      'meetings',
      'fallback-audio',
      `${id}.spool`
    )
  );
}

async function recoveredAudio(id: string) {
  const result = [];
  for await (const window of spool(id).windows()) result.push(...window);
  return result;
}

function stop(id: string) {
  return request(`/v1/meetings/${id}/stop`, { method: 'POST', body: '{}' });
}

async function startChild() {
  const require = createRequire(import.meta.url);
  const serverPath = fileURLToPath(new URL('./server.ts', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      '--import',
      require.resolve('tsx'),
      '--input-type=module',
      '--eval',
      `import { createServer } from ${JSON.stringify(serverPath)};
     const { app } = createServer();
     const server = app.listen(0, '127.0.0.1', () =>
       console.log('AUDIO_READY:' + server.address().port));`,
    ],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  children.push(child);
  let errors = '';
  child.stderr!.on('data', chunk => {
    errors += chunk.toString();
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`Child timeout: ${errors}`)),
      15000
    );
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Child exited ${code}: ${errors}`));
    });
    child.stdout!.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/AUDIO_READY:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });
  return child;
}

describe('meeting audio acceptance durability', () => {
  test('ACK survives SIGKILL, resume with new speech, failed finalization and another restart', async () => {
    const child = await startChild();
    const id = await reserve();
    const response = await postFrame(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      chunk: null,
      duplicate: false,
    });
    await kill(child);

    const restarted = await startChild();
    const restored = await request(`/v1/meetings/${id}`);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      meeting: { status: 'stopped' },
    });
    const recovered = await recoveredAudio(id);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      source: 'mic',
      startMs: 0,
      endMs: 500,
    });
    expect(recovered[0].pcm16).toEqual(new Int16Array(8000).fill(6553));

    const resumed = await request('/v1/meetings/start', {
      method: 'POST',
      body: JSON.stringify({ meetingId: id, resume: true }),
    });
    expect(resumed.status).toBe(200);
    const retry = await postFrame(id);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ duplicate: true });
    expect((await recoveredAudio(id))[0].pcm16.length).toBe(8000);
    const beforeResumeAppend = await readFile(spool(id).sourceFilePath('mic'));
    const nextFrame = await postFrame(id, 500);
    expect(nextFrame.status).toBe(200);
    expect(await nextFrame.json()).toMatchObject({
      chunk: null,
      duplicate: false,
    });
    const stopped = await stop(id);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({
      meeting: {
        stt: {
          message: expect.stringContaining(
            'captured speech remains on disk for retry'
          ),
        },
      },
    });
    const retained = await readFile(spool(id).sourceFilePath('mic'));
    expect(retained.subarray(0, beforeResumeAppend.length)).toEqual(
      beforeResumeAppend
    );
    expect(retained.length).toBeGreaterThan(beforeResumeAppend.length);

    // Resume resets only live VAD; final fallback must still replay the old
    // accepted tail together with new speech, even after another process exit.
    await kill(restarted);
    await startChild();
    expect((await request(`/v1/meetings/${id}`)).status).toBe(200);
    expect(await readFile(spool(id).sourceFilePath('mic'))).toEqual(retained);
    const allAudio = await recoveredAudio(id);
    expect(allAudio).toHaveLength(1);
    expect(allAudio[0]).toMatchObject({
      source: 'mic',
      startMs: 0,
      endMs: 1000,
    });
    expect(allAudio[0].pcm16).toEqual(new Int16Array(16000).fill(6553));
  }, 30000);

  test('sync failure is not ACKed; closing-silence retry retains earlier accepted speech', async () => {
    const id = await reserve();
    expect((await postFrame(id)).status).toBe(200);
    io.failSync = true;
    const rejected = await postFrame(id, 500, false);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: 'injected audio fsync failure',
    });
    const retry = await postFrame(id, 500, false);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      audioFrames: 2,
      duplicate: false,
      chunk: { startMs: 0, endMs: 1000 },
    });
    const result = await recoveredAudio(id);
    expect(result[0].pcm16.length).toBe(16000);
    expect(result[0].pcm16.slice(0, 8000)).toEqual(
      new Int16Array(8000).fill(6553)
    );
    await stop(id);
  });

  test('write/open failure does not mutate counters or remember a rejected ID', async () => {
    const id = await reserve();
    await mkdir(spool(id).sourceFilePath('mic'), { recursive: true });
    expect((await postFrame(id)).status).toBe(400);
    await rm(spool(id).sourceFilePath('mic'), { recursive: true });
    const retry = await postFrame(id);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      audioFrames: 1,
      duplicate: false,
    });
    await stop(id);
  });

  test('rolls back a partially written record before accepting its retry', async () => {
    const id = await reserve();
    expect((await postFrame(id)).status).toBe(200);
    const before = await readFile(spool(id).sourceFilePath('mic'));
    io.failWrite = true;
    expect((await postFrame(id, 500)).status).toBe(400);
    expect(await readFile(spool(id).sourceFilePath('mic'))).toEqual(before);
    const retry = await postFrame(id, 500);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      audioFrames: 2,
      duplicate: false,
    });
    expect((await recoveredAudio(id))[0].pcm16.length).toBe(16000);
    await stop(id);
  });

  test('durably normalizes stereo system audio and retains its source, timing and request ID', async () => {
    const id = await reserve();
    const samples = new Float32Array(48000).fill(0.2);
    const response = await request(
      `/v1/meetings/${id}/audio-frame?${new URLSearchParams({
        source: 'system',
        channels: '2',
        sampleRate: '48000',
        startMs: '1250',
        endMs: '1750',
        frameId: 'system:480000:672000',
      })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: samples.buffer,
      }
    );
    expect(response.status).toBe(200);
    const bytes = await readFile(spool(id).sourceFilePath('system'));
    const header = JSON.parse(
      bytes.subarray(4, 4 + bytes.readUInt32LE(0)).toString()
    );
    expect(header).toMatchObject({
      id: 'system:480000:672000',
      source: 'system',
      startMs: 1250,
      endMs: 1750,
      sampleRate: 16000,
      pcmBytes: 16000,
      version: 2,
    });
    expect((await recoveredAudio(id))[0]).toMatchObject({
      source: 'system',
      startMs: 1250,
      endMs: 1750,
      sampleRate: 16000,
    });
    await stop(id);
  });

  test('stop waits for in-flight sync; no ACK or finalization overtakes the durable write', async () => {
    const id = await reserve();
    const entered = new Promise<void>(resolve => {
      io.entered = resolve;
    });
    io.gate = new Promise<void>(resolve => {
      releaseGate = resolve;
    });
    let acked = false;
    const accepting = postFrame(id).then(response => {
      acked = true;
      return response;
    });
    await entered;
    let stopped = false;
    const stopping = stop(id).then(response => {
      stopped = true;
      return response;
    });
    await vi.waitFor(async () => {
      const response = await request(`/v1/meetings/${id}`);
      expect((await response.json()).meeting.status).toBe('stopped');
    });
    expect(acked).toBe(false);
    expect(stopped).toBe(false);
    releaseGate!();
    expect((await accepting).status).toBe(200);
    expect((await stopping).status).toBe(200);
    expect((await recoveredAudio(id))[0]).toMatchObject({
      startMs: 0,
      endMs: 500,
    });
    expect((await postFrame(id, 500)).status).toBe(409);
    const persisted = JSON.parse(
      await readFile(
        path.join(workspaceRoot, '.nota', 'meetings', 'sessions.json'),
        'utf8'
      )
    );
    expect(
      persisted.meetings.find(
        (item: { meeting: { id: string } }) => item.meeting.id === id
      ).meeting.status
    ).toBe('stopped');
  });

  test('concurrent HTTP retries append exactly one durable frame', async () => {
    const id = await reserve();
    const responses = await Promise.all([postFrame(id), postFrame(id)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(
      responses.map(response => response.json())
    );
    expect(
      bodies
        .map(body => body.duplicate)
        .sort((first, second) => Number(first) - Number(second))
    ).toEqual([false, true]);
    expect(bodies.map(body => body.audioFrames)).toEqual([1, 1]);
    expect((await recoveredAudio(id))[0].pcm16.length).toBe(8000);
    await stop(id);
  });
});
