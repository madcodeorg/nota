import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { requiredFilesFor } from './model-registry.js';
import { createServer } from './server.js';
import * as sherpa from './sherpa-stt.js';

const TOKEN = 'meeting-start-test-token';
const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  seededModelRoot: process.env.NOTA_AI_SEEDED_MODEL_ROOT,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

let workspaceRoot = '';
let baseUrl = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-meeting-start-'));
  process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
  process.env.NOTA_AI_SEEDED_MODEL_ROOT = path.join(
    workspaceRoot,
    'missing-seeds'
  );
  process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;

  const { app } = createServer();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
  await rm(workspaceRoot, { force: true, recursive: true });

  for (const [name, value] of Object.entries({
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_SEEDED_MODEL_ROOT: originalEnvironment.seededModelRoot,
    NOTA_AI_WORKSPACE_ROOT: originalEnvironment.workspaceRoot,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function request(pathname: string, init?: RequestInit) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-nota-backend-token': TOKEN,
      ...init?.headers,
    },
  });
}

function startMeeting(workspaceId: string) {
  return request('/v1/meetings/start', {
    body: JSON.stringify({ workspaceId }),
    method: 'POST',
  });
}

function reserveMeeting(workspaceId: string) {
  return request('/v1/meetings/reserve', {
    body: JSON.stringify({ workspaceId }),
    method: 'POST',
  });
}

function activateMeeting(
  meetingId: string,
  workspaceId: string,
  resume = false
) {
  return request('/v1/meetings/start', {
    body: JSON.stringify({ meetingId, resume, workspaceId }),
    method: 'POST',
  });
}

async function stopMeeting(id: string) {
  const response = await request(`/v1/meetings/${id}/stop`, {
    body: JSON.stringify({}),
    method: 'POST',
  });
  expect(response.ok).toBe(true);
}

describe('meeting start exclusivity', () => {
  test('keeps provider and language together when settings switch during discovery', async () => {
    for (const model of [
      'sherpa-nemotron-3.5-streaming-560ms-int8',
      'whisper-tiny-en-onnx-q4',
    ]) {
      const root = path.join(workspaceRoot, '.nota/models', model);
      await mkdir(root, { recursive: true });
      for (const file of requiredFilesFor(model))
        await writeFile(path.join(root, file), 'fixture');
    }
    const runtimeAvailable = vi
      .spyOn(sherpa, 'sherpaRuntimeAvailable')
      .mockResolvedValue(true);
    expect(
      (
        await request('/api/ai/settings', {
          method: 'POST',
          body: JSON.stringify({
            meetingSttProviderId: 'nemotron-sherpa',
            meetingSttModelId: 'sherpa-nemotron-3.5-streaming-560ms-int8',
            meetingSttLanguage: 'fr-CA',
          }),
        })
      ).status
    ).toBe(200);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const discovery = new Promise<void>(resolve => {
      entered = resolve;
    });
    let blocked = false;
    runtimeAvailable.mockImplementation(async () => {
      if (!blocked) {
        blocked = true;
        entered();
        await gate;
      }
      return true;
    });
    const pending = reserveMeeting('concurrent-language');
    await discovery;
    try {
      expect(
        (
          await request('/api/ai/settings', {
            method: 'POST',
            body: JSON.stringify({
              meetingSttProviderId: 'whisper-tiny-en-onnx',
              meetingSttModelId: 'whisper-tiny-en-onnx-q4',
              meetingSttLanguage: 'auto',
            }),
          })
        ).status
      ).toBe(200);
    } finally {
      release();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    const { meeting } = await response.json();
    expect(meeting).toMatchObject({
      providerId: 'nemotron-sherpa',
      sttModelId: 'sherpa-nemotron-3.5-streaming-560ms-int8',
      sttLanguage: 'fr-CA',
    });
    await stopMeeting(meeting.id);
  });
  test('snapshots language at reserve and preserves it through settings changes and recovery', async () => {
    const model = 'sherpa-nemotron-3.5-streaming-560ms-int8';
    const root = path.join(workspaceRoot, '.nota/models', model);
    await mkdir(root, { recursive: true });
    for (const file of requiredFilesFor(model))
      await writeFile(path.join(root, file), 'fixture');
    vi.spyOn(sherpa, 'sherpaRuntimeAvailable').mockResolvedValue(true);
    const save = await request('/api/ai/settings', {
      method: 'POST',
      body: JSON.stringify({
        meetingSttProviderId: 'nemotron-sherpa',
        meetingSttLanguage: 'fr-CA',
      }),
    });
    expect(save.status).toBe(200);
    const reserved = await reserveMeeting('language-snapshot');
    expect(reserved.status).toBe(200);
    const { meeting } = await reserved.json();
    expect(meeting.sttLanguage).toBe('fr-CA');
    expect(meeting.stt.detectedLanguage).toBeNull();
    await request('/api/ai/settings', {
      method: 'POST',
      body: JSON.stringify({ meetingSttLanguage: 'en-US' }),
    });
    await request(`/v1/meetings/${meeting.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ sttLanguage: 'en-US' }),
    });
    expect(
      await (await request(`/v1/meetings/${meeting.id}`)).json()
    ).toMatchObject({ meeting: { sttLanguage: 'fr-CA' } });
    await stopMeeting(meeting.id);
    const persisted = JSON.parse(
      await readFile(
        path.join(workspaceRoot, '.nota/meetings/sessions.json'),
        'utf8'
      )
    );
    expect(JSON.stringify(persisted)).toContain('"sttLanguage":"fr-CA"');
    const resumed = await activateMeeting(
      meeting.id,
      'language-snapshot',
      true
    );
    expect(await resumed.json()).toMatchObject({
      meeting: { sttLanguage: 'fr-CA', stt: { detectedLanguage: null } },
    });
    await stopMeeting(meeting.id);
  });

  test('honors a saved missing model instead of silently starting a different one', async () => {
    const model = 'sherpa-nemotron-3.5-streaming-560ms-int8';
    const root = path.join(workspaceRoot, '.nota/models', model);
    await mkdir(root, { recursive: true });
    for (const file of requiredFilesFor(model))
      await writeFile(path.join(root, file), 'fixture');
    vi.spyOn(sherpa, 'sherpaRuntimeAvailable').mockResolvedValue(true);
    expect(
      (
        await request('/api/ai/settings', {
          method: 'POST',
          body: JSON.stringify({
            meetingSttProviderId: 'whisper-tiny-en-onnx',
            meetingSttModelId: 'whisper-tiny-en-onnx-q4',
            meetingSttLanguage: 'auto',
          }),
        })
      ).status
    ).toBe(200);
    const preload = await request('/v1/stt/runtime/preload', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(await preload.json()).toMatchObject({
      preload: {
        available: false,
        requestedProviderId: 'whisper-tiny-en-onnx',
      },
    });
    for (const route of ['/v1/meetings/reserve', '/v1/meetings/start']) {
      const response = await request(route, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'saved-selection' }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Whisper|runtime/i);
    }
    // Fallback remains available when the caller deliberately chooses Auto.
    const response = await request('/v1/meetings/reserve', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: 'saved-selection',
        providerId: 'auto',
      }),
    });
    expect(response.status).toBe(200);
    const { meeting } = await response.json();
    expect(meeting.providerId).toBe('nemotron-sherpa');
    await stopMeeting(meeting.id);
    expect(await (await request('/api/ai/settings')).json()).toMatchObject({
      meetings: { sttProviderId: 'whisper-tiny-en-onnx' },
    });
  });

  test.each([null, 42, 'xx-XX'])(
    'rejects invalid reservation language %s',
    async sttLanguage => {
      const response = await request('/v1/meetings/reserve', {
        method: 'POST',
        body: JSON.stringify({ sttLanguage }),
      });
      expect(response.status).toBe(400);
    }
  );
  test('reserves before capture and activates the same meeting idempotently', async () => {
    const reserved = await reserveMeeting('workspace-reserved');
    expect(reserved.status).toBe(200);
    const reservation = (await reserved.json()) as {
      meeting: { id: string; stt: { message: string }; workspaceId: string };
    };
    expect(reservation.meeting).toMatchObject({
      stt: {
        message: 'Meeting capture is reserved and waiting for native audio.',
      },
      workspaceId: 'workspace-reserved',
    });

    try {
      const firstStart = await activateMeeting(
        reservation.meeting.id,
        'workspace-reserved'
      );
      expect(firstStart.status).toBe(200);
      await expect(firstStart.json()).resolves.toMatchObject({
        meeting: { id: reservation.meeting.id, status: 'recording' },
      });

      // A lost HTTP acknowledgement can replay start without creating or
      // resetting a second meeting session.
      const replay = await activateMeeting(
        reservation.meeting.id,
        'workspace-reserved'
      );
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        meeting: { id: reservation.meeting.id, status: 'recording' },
      });
    } finally {
      await stopMeeting(reservation.meeting.id);
    }
  });

  test('resumes a stopped reserved id for recovered raw audio', async () => {
    const reserved = await reserveMeeting('workspace-recovery');
    const reservation = (await reserved.json()) as {
      meeting: { id: string };
    };
    await stopMeeting(reservation.meeting.id);

    const resumed = await activateMeeting(
      reservation.meeting.id,
      'workspace-recovery',
      true
    );
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      meeting: { id: reservation.meeting.id, status: 'recording' },
    });
    await stopMeeting(reservation.meeting.id);
  });

  test('returns the active meeting when the same workspace starts twice', async () => {
    const first = await startMeeting('workspace-same');
    expect(first.status).toBe(200);
    const started = (await first.json()) as {
      meeting: { id: string; workspaceId: string };
    };

    try {
      const second = await startMeeting('workspace-same');
      expect(second.status).toBe(409);
      await expect(second.json()).resolves.toMatchObject({
        error:
          'Another meeting is already recording. Stop it before starting a new meeting.',
        meeting: {
          id: started.meeting.id,
          status: 'recording',
          workspaceId: 'workspace-same',
        },
      });
    } finally {
      await stopMeeting(started.meeting.id);
    }
  });

  test('blocks a second active meeting from a different workspace', async () => {
    const first = await startMeeting('workspace-one');
    expect(first.status).toBe(200);
    const started = (await first.json()) as {
      meeting: { id: string; workspaceId: string };
    };

    try {
      const second = await startMeeting('workspace-two');
      expect(second.status).toBe(409);
      await expect(second.json()).resolves.toMatchObject({
        meeting: {
          id: started.meeting.id,
          status: 'recording',
          workspaceId: 'workspace-one',
        },
      });
    } finally {
      await stopMeeting(started.meeting.id);
    }
  });

  test('atomically admits only one of two concurrent starts', async () => {
    const responses = await Promise.all([
      startMeeting('workspace-concurrent-one'),
      startMeeting('workspace-concurrent-two'),
    ]);
    expect(
      responses.map(response => response.status).sort((a, b) => a - b)
    ).toEqual([200, 409]);

    const startedResponse = responses.find(response => response.status === 200);
    const conflictResponse = responses.find(
      response => response.status === 409
    );
    expect(startedResponse).toBeDefined();
    expect(conflictResponse).toBeDefined();

    const started = (await startedResponse?.json()) as {
      meeting: { id: string; workspaceId: string };
    };
    try {
      await expect(conflictResponse?.json()).resolves.toMatchObject({
        meeting: {
          id: started.meeting.id,
          status: 'recording',
          workspaceId: started.meeting.workspaceId,
        },
      });
    } finally {
      await stopMeeting(started.meeting.id);
    }
  });
});
