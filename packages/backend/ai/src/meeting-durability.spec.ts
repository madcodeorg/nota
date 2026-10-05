import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const meetingSummaryMocks = vi.hoisted(() => ({
  generateMeetingSummary: vi.fn(),
}));

vi.mock('./meeting-summary', async importOriginal => {
  const actual = await importOriginal<typeof import('./meeting-summary.js')>();
  return {
    ...actual,
    generateMeetingSummary: meetingSummaryMocks.generateMeetingSummary,
  };
});

import { createServer } from './server.js';

const TOKEN = 'meeting-durability-test-token';
const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  meetingProvider: process.env.NOTA_MEETING_STT_PROVIDER,
  openaiApiKey: process.env.OPENAI_API_KEY,
  provider: process.env.NOTA_AI_PROVIDER,
  seededModelRoot: process.env.NOTA_AI_SEEDED_MODEL_ROOT,
  settingsPath: process.env.NOTA_AI_SETTINGS_PATH,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

let workspaceRoot = '';
let baseUrl = '';
let sessionsPath = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-durability-'));
  sessionsPath = path.join(workspaceRoot, '.nota', 'meetings', 'sessions.json');
  process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
  process.env.NOTA_AI_PROVIDER = 'openai';
  process.env.NOTA_AI_SEEDED_MODEL_ROOT = path.join(
    workspaceRoot,
    'missing-seeds'
  );
  process.env.NOTA_AI_SETTINGS_PATH = path.join(
    workspaceRoot,
    '.nota',
    'ai-settings.json'
  );
  process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
  process.env.NOTA_MEETING_STT_PROVIDER = 'auto';
  process.env.OPENAI_API_KEY = 'meeting-durability-test-key';

  meetingSummaryMocks.generateMeetingSummary.mockReset();
  meetingSummaryMocks.generateMeetingSummary.mockResolvedValue({
    model: 'mock-summary-model',
    provider: 'local',
    runtime: 'local-onnx',
    structured: {
      actionItems: [],
      decisions: [],
      followUps: [],
      keyTakeaways: ['The generated summary is durable.'],
      openQuestions: [],
      overview: 'A generated durability summary.',
      risksAndBlockers: [],
      title: 'Durable generated summary',
      topics: [],
    },
    text: '# Durable generated summary\n\nA generated durability summary.',
  });

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
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
  await rm(workspaceRoot, { force: true, recursive: true });

  for (const [name, value] of Object.entries({
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_PROVIDER: originalEnvironment.provider,
    NOTA_AI_SEEDED_MODEL_ROOT: originalEnvironment.seededModelRoot,
    NOTA_AI_SETTINGS_PATH: originalEnvironment.settingsPath,
    NOTA_AI_WORKSPACE_ROOT: originalEnvironment.workspaceRoot,
    NOTA_MEETING_STT_PROVIDER: originalEnvironment.meetingProvider,
    OPENAI_API_KEY: originalEnvironment.openaiApiKey,
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

async function reserveMeeting() {
  const response = await request('/v1/meetings/reserve', {
    body: JSON.stringify({ workspaceId: 'durability-workspace' }),
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { meeting: { id: string } };
  return body.meeting.id;
}

async function makeSessionsPathRejectAtomicRename() {
  await rm(sessionsPath, { force: true, recursive: true });
  await mkdir(sessionsPath, { recursive: true });
}

async function restoreSessionsPath() {
  await rm(sessionsPath, { force: true, recursive: true });
}

async function readPersistedMeeting(meetingId: string) {
  const stored = JSON.parse(await readFile(sessionsPath, 'utf8')) as {
    meetings: Array<{
      meeting: {
        docId: string | null;
        id: string;
        recordingDurationMs: number | null;
        summary: string | null;
      };
    }>;
  };
  return stored.meetings.find(item => item.meeting.id === meetingId)?.meeting;
}

async function expectPersistenceFailure(response: Response, mutation: string) {
  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    error: expect.stringContaining(`Failed to persist ${mutation}:`),
  });
}

describe('meeting mutation durability acknowledgements', () => {
  test('rejects PATCH and both summary branches until sessions.json can persist', async () => {
    const meetingId = await reserveMeeting();
    const update = {
      docId: 'durable-meeting-note',
      recordingDurationMs: 42_000,
    };

    await makeSessionsPathRejectAtomicRename();
    await expectPersistenceFailure(
      await request(`/v1/meetings/${meetingId}`, {
        body: JSON.stringify(update),
        method: 'PATCH',
      }),
      'meeting update'
    );

    const inMemoryUpdate = await request(`/v1/meetings/${meetingId}`);
    await expect(inMemoryUpdate.json()).resolves.toMatchObject({
      meeting: update,
    });

    await restoreSessionsPath();
    const updateRetry = await request(`/v1/meetings/${meetingId}`, {
      body: JSON.stringify(update),
      method: 'PATCH',
    });
    expect(updateRetry.status).toBe(200);
    expect(await readPersistedMeeting(meetingId)).toMatchObject(update);

    const providedSummary = '# Durable provided summary';
    await makeSessionsPathRejectAtomicRename();
    await expectPersistenceFailure(
      await request(`/v1/meetings/${meetingId}/summary`, {
        body: JSON.stringify({ summary: providedSummary }),
        method: 'POST',
      }),
      'meeting summary'
    );

    await restoreSessionsPath();
    const providedSummaryRetry = await request(
      `/v1/meetings/${meetingId}/summary`,
      {
        body: JSON.stringify({ summary: providedSummary }),
        method: 'POST',
      }
    );
    expect(providedSummaryRetry.status).toBe(200);
    expect(await readPersistedMeeting(meetingId)).toMatchObject({
      summary: providedSummary,
    });

    const generatedSummaryRequest = {
      notes: 'Generate the same durable summary on retry.',
    };
    await makeSessionsPathRejectAtomicRename();
    await expectPersistenceFailure(
      await request(`/v1/meetings/${meetingId}/summary`, {
        body: JSON.stringify(generatedSummaryRequest),
        method: 'POST',
      }),
      'meeting summary'
    );

    await restoreSessionsPath();
    const generatedSummaryRetry = await request(
      `/v1/meetings/${meetingId}/summary`,
      {
        body: JSON.stringify(generatedSummaryRequest),
        method: 'POST',
      }
    );
    expect(generatedSummaryRetry.status).toBe(200);
    expect(meetingSummaryMocks.generateMeetingSummary).toHaveBeenCalledTimes(2);
    expect(await readPersistedMeeting(meetingId)).toMatchObject({
      summary: '# Durable generated summary\n\nA generated durability summary.',
    });
  });
});
