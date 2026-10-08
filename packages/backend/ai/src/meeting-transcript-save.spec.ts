import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const cacheReadGate = vi.hoisted(() => ({
  current: null as {
    entered: () => void;
    filePath: string;
    resume: Promise<void>;
  } | null,
}));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const gate = cacheReadGate.current;
      if (gate && String(args[0]) === gate.filePath) {
        gate.entered();
        await gate.resume;
      }
      return actual.readFile(...args);
    },
  };
});

const TOKEN = 'meeting-transcript-save-test-token';
const environment = {
  NOTA_AI_BACKEND_TOKEN: process.env.NOTA_AI_BACKEND_TOKEN,
  NOTA_AI_SEEDED_MODEL_ROOT: process.env.NOTA_AI_SEEDED_MODEL_ROOT,
  NOTA_AI_SETTINGS_PATH: process.env.NOTA_AI_SETTINGS_PATH,
  NOTA_AI_WORKSPACE_ROOT: process.env.NOTA_AI_WORKSPACE_ROOT,
  NOTA_MEETING_STT_PROVIDER: process.env.NOTA_MEETING_STT_PROVIDER,
};
const originalSegment = {
  endMs: 1_000,
  id: 'same-id',
  source: 'mic',
  startMs: 0,
  text: 'Original transcript.',
  type: 'final',
};
const originalSnapshot = '[1,"Original transcript.",0,1000,"mic"]';
const revisedSnapshot = '[1,"Revised transcript.",0,1000,"mic"]';

let workspaceRoot = '';
let sessionsPath = '';
let baseUrl = '';
let server:
  | ReturnType<
      ReturnType<
        (typeof import('./server.js'))['createServer']
      >['app']['listen']
    >
  | undefined;

async function startServer() {
  const { createServer } = await import('./server.js');
  const { loadConfig } = await import('./config.js');
  const { resumeRetainedMeetingTranscriptions } = await import('./meetings.js');
  await resumeRetainedMeetingTranscriptions(loadConfig());
  const current = createServer().app.listen(0, '127.0.0.1');
  server = current;
  await new Promise<void>((resolve, reject) => {
    current.once('listening', resolve);
    current.once('error', reject);
  });
  const address = current.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function closeServer() {
  const current = server;
  server = undefined;
  if (!current) return;
  await new Promise<void>((resolve, reject) => {
    current.close(error => (error ? reject(error) : resolve()));
  });
}

async function restartServer() {
  await closeServer();
  vi.resetModules();
  await startServer();
}

beforeEach(async () => {
  cacheReadGate.current = null;
  vi.resetModules();
  workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nota-transcript-save-')
  );
  sessionsPath = path.join(workspaceRoot, '.nota', 'meetings', 'sessions.json');
  process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
  process.env.NOTA_AI_SEEDED_MODEL_ROOT = path.join(workspaceRoot, 'no-seeds');
  process.env.NOTA_AI_SETTINGS_PATH = path.join(
    workspaceRoot,
    '.nota',
    'ai-settings.json'
  );
  process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
  process.env.NOTA_MEETING_STT_PROVIDER = 'auto';
  await startServer();
});

afterEach(async () => {
  try {
    if (server) {
      const { loadConfig } = await import('./config.js');
      const { finalizeMeetingsBeforeShutdown } = await import('./meetings.js');
      await finalizeMeetingsBeforeShutdown(loadConfig());
    }
  } finally {
    try {
      await closeServer();
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }
});

function request(pathname: string, init?: RequestInit) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-nota-backend-token': TOKEN,
    },
  });
}

async function reserveMeeting() {
  const response = await request('/v1/meetings/reserve', {
    body: JSON.stringify({ workspaceId: 'save-workspace' }),
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { meeting: { id: string } };
  const meetingId = body.meeting.id;
  const transcript = await request(`/v1/meetings/${meetingId}/transcript`, {
    body: JSON.stringify(originalSegment),
    method: 'POST',
  });
  expect(transcript.status).toBe(200);
  return meetingId;
}

async function patch(meetingId: string, update: unknown) {
  return request(`/v1/meetings/${meetingId}`, {
    body: JSON.stringify(update),
    method: 'PATCH',
  });
}

async function stop(meetingId: string) {
  const response = await request(`/v1/meetings/${meetingId}/stop`, {
    body: '{}',
    method: 'POST',
  });
  expect(response.status).toBe(200);
}

describe('saved meeting transcript content acknowledgements', () => {
  test('persists the submitted snapshot rather than acknowledging newer same-ID text', async () => {
    const meetingId = await reserveMeeting();
    const revision = await request(`/v1/meetings/${meetingId}/transcript`, {
      body: JSON.stringify({
        ...originalSegment,
        text: 'Revised transcript.',
      }),
      method: 'POST',
    });
    expect(revision.status).toBe(200);
    await stop(meetingId);

    const saved = await patch(meetingId, {
      docId: 'canonical-user-edited-note',
      savedTranscriptSegmentIds: ['same-id', 'unknown-id'],
      savedTranscriptSegmentSnapshots: {
        'same-id': originalSnapshot,
        'unknown-id': originalSnapshot,
      },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentIds: ['same-id'],
        savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
        transcriptSaveInitialized: true,
        transcriptSegments: [{ id: 'same-id', text: 'Revised transcript.' }],
      },
    });

    await restartServer();
    const restored = await request(`/v1/meetings/${meetingId}`);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
        transcriptSegments: [{ id: 'same-id', text: 'Revised transcript.' }],
      },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const acknowledged = await patch(meetingId, {
        savedTranscriptSegmentSnapshots: { 'same-id': revisedSnapshot },
      });
      expect(acknowledged.status).toBe(200);
      expect(await acknowledged.json()).toMatchObject({
        meeting: {
          savedTranscriptSegmentIds: ['same-id'],
          savedTranscriptSegmentSnapshots: { 'same-id': revisedSnapshot },
        },
      });
    }
    const persisted = JSON.parse(await readFile(sessionsPath, 'utf8'));
    expect(persisted.meetings[0].meeting).toMatchObject({
      savedTranscriptSegmentSnapshots: { 'same-id': revisedSnapshot },
    });
  });

  test('keeps ID-only saves compatible without fabricating content acknowledgements', async () => {
    const meetingId = await reserveMeeting();
    await stop(meetingId);
    const legacy = await patch(meetingId, {
      docId: 'legacy-note',
      savedTranscriptSegmentIds: ['same-id'],
    });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentIds: ['same-id'],
        savedTranscriptSegmentSnapshots: {},
        transcriptSaveInitialized: true,
      },
    });
    const migrated = await patch(meetingId, {
      savedTranscriptSegmentIds: ['same-id'],
      savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
    });
    expect(migrated.status).toBe(200);
    const olderClient = await patch(meetingId, {
      savedTranscriptSegmentIds: ['same-id'],
    });
    expect(olderClient.status).toBe(200);
    expect(await olderClient.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
      },
    });
  });

  test('restores an old ID-only cache without treating current text as saved', async () => {
    const meetingId = await reserveMeeting();
    await stop(meetingId);
    expect(
      (
        await patch(meetingId, {
          docId: 'legacy-note',
          savedTranscriptSegmentIds: ['same-id'],
        })
      ).status
    ).toBe(200);
    const persisted = JSON.parse(await readFile(sessionsPath, 'utf8'));
    delete persisted.meetings[0].meeting.savedTranscriptSegmentSnapshots;
    await writeFile(sessionsPath, JSON.stringify(persisted));
    await restartServer();

    const restored = await request(`/v1/meetings/${meetingId}`);
    expect(restored.status).toBe(200);
    const body = await restored.json();
    expect(body.meeting).toMatchObject({
      savedTranscriptSegmentIds: ['same-id'],
      transcriptSaveInitialized: true,
    });
    expect(body.meeting.savedTranscriptSegmentSnapshots).toBeUndefined();
  });

  test('rejects malformed maps before mutating the meeting or its watermark', async () => {
    const meetingId = await reserveMeeting();
    for (const invalid of [
      null,
      [],
      'same-id',
      { 'same-id': 1 },
      { 'same-id': '' },
      { 'same-id': '   ' },
      { 'same-id': {} },
      { 'same-id': [] },
      { '': originalSnapshot },
      { '   ': originalSnapshot },
      Object.fromEntries(
        Array.from({ length: 20_001 }, (_, index) => [
          String(index),
          originalSnapshot,
        ])
      ),
    ]) {
      const response = await patch(meetingId, {
        docId: 'must-not-be-linked',
        savedTranscriptSegmentSnapshots: invalid,
      });
      expect(response.status).toBe(400);
    }
    const unchanged = await request(`/v1/meetings/${meetingId}`);
    expect(await unchanged.json()).toMatchObject({
      meeting: {
        docId: null,
        savedTranscriptSegmentSnapshots: {},
        transcriptSaveInitialized: false,
      },
    });
  });

  test('roundtrips prototype-named segment IDs as own data properties', async () => {
    const meetingId = await reserveMeeting();
    const ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const snapshots = Object.fromEntries(
      await Promise.all(
        ids.map(async (id, index) => {
          const segment = {
            ...originalSegment,
            endMs: (index + 2) * 10_000 + 1_000,
            id,
            startMs: (index + 2) * 10_000,
            text: `Distinct transcript for ${id}.`,
          };
          const response = await request(
            `/v1/meetings/${meetingId}/transcript`,
            { body: JSON.stringify(segment), method: 'POST' }
          );
          expect(response.status).toBe(200);
          return [
            id,
            JSON.stringify([
              1,
              segment.text,
              segment.startMs,
              segment.endMs,
              segment.source,
            ]),
          ];
        })
      )
    );
    await stop(meetingId);
    const saved = await patch(meetingId, {
      savedTranscriptSegmentSnapshots: snapshots,
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.meeting.savedTranscriptSegmentSnapshots).toEqual(snapshots);
    for (const id of ids) {
      expect(
        Object.hasOwn(body.meeting.savedTranscriptSegmentSnapshots, id)
      ).toBe(true);
    }
    expect(Object.getPrototypeOf(snapshots)).toBe(Object.prototype);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);

    await restartServer();
    const restored = await request(`/v1/meetings/${meetingId}`);
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json();
    expect(restoredBody.meeting.savedTranscriptSegmentSnapshots).toEqual(
      snapshots
    );
    for (const id of ids) {
      expect(
        Object.hasOwn(restoredBody.meeting.savedTranscriptSegmentSnapshots, id)
      ).toBe(true);
    }
  });

  test('does not fabricate snapshots for mismatched IDs or non-final segments', async () => {
    const meetingId = await reserveMeeting();
    const partial = await request(`/v1/meetings/${meetingId}/transcript`, {
      body: JSON.stringify({
        ...originalSegment,
        id: 'partial-id',
        type: 'partial',
      }),
      method: 'POST',
    });
    expect(partial.status).toBe(200);
    const mismatched = await patch(meetingId, {
      savedTranscriptSegmentIds: ['same-id', 'partial-id', 'unknown-id'],
      savedTranscriptSegmentSnapshots: {
        'partial-id': originalSnapshot,
        'unknown-id': originalSnapshot,
      },
    });
    expect(mismatched.status).toBe(200);
    expect(await mismatched.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentIds: ['same-id'],
        savedTranscriptSegmentSnapshots: {},
      },
    });
    const empty = await patch(meetingId, {
      savedTranscriptSegmentSnapshots: {},
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentIds: [],
        savedTranscriptSegmentSnapshots: {},
      },
    });
  });

  test('preserves opaque malformed or unknown-version snapshots without converting them to current content', async () => {
    const meetingId = await reserveMeeting();
    await stop(meetingId);
    for (const snapshot of [
      'not-json',
      'null',
      '{}',
      '[1]',
      '[2,"Original transcript.",0,1000,"mic"]',
    ]) {
      const response = await patch(meetingId, {
        savedTranscriptSegmentSnapshots: { 'same-id': snapshot },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        meeting: {
          savedTranscriptSegmentSnapshots: { 'same-id': snapshot },
        },
      });
    }
  });

  test('keeps a delayed older ACK conservative after a newer snapshot was acknowledged', async () => {
    const meetingId = await reserveMeeting();
    const revision = await request(`/v1/meetings/${meetingId}/transcript`, {
      body: JSON.stringify({ ...originalSegment, text: 'Revised transcript.' }),
      method: 'POST',
    });
    expect(revision.status).toBe(200);
    await stop(meetingId);
    for (const snapshot of [revisedSnapshot, originalSnapshot]) {
      const response = await patch(meetingId, {
        savedTranscriptSegmentSnapshots: { 'same-id': snapshot },
      });
      expect(response.status).toBe(200);
    }
    await restartServer();
    const restored = await request(`/v1/meetings/${meetingId}`);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
        transcriptSegments: [{ id: 'same-id', text: 'Revised transcript.' }],
      },
    });
  });

  test('makes concurrent reload callers await the same cache hydration', async () => {
    const meetingId = await reserveMeeting();
    await stop(meetingId);
    expect(
      (
        await patch(meetingId, {
          savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
        })
      ).status
    ).toBe(200);
    await closeServer();
    vi.resetModules();
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>(resolve => {
      entered = resolve;
    });
    cacheReadGate.current = {
      entered,
      filePath: sessionsPath,
      resume: new Promise<void>(resolve => {
        release = resolve;
      }),
    };
    const { loadConfig } = await import('./config.js');
    const { resumeRetainedMeetingTranscriptions } =
      await import('./meetings.js');
    const first = resumeRetainedMeetingTranscriptions(loadConfig());
    await reading;
    let secondResolved = false;
    const second = resumeRetainedMeetingTranscriptions(loadConfig()).then(
      () => {
        secondResolved = true;
      }
    );
    try {
      // Drain the event loop while the cache read is deliberately suspended.
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(secondResolved).toBe(false);
    } finally {
      release();
      cacheReadGate.current = null;
      await Promise.all([first, second]);
      await startServer();
    }
    const restored = await request(`/v1/meetings/${meetingId}`);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
      },
    });
  });

  test('does not acknowledge a watermark PATCH until its cache write succeeds', async () => {
    const meetingId = await reserveMeeting();
    await stop(meetingId);
    const update = {
      docId: 'saved-note',
      savedTranscriptSegmentSnapshots: { 'same-id': originalSnapshot },
    };
    await rm(sessionsPath);
    await mkdir(sessionsPath);
    try {
      const failed = await patch(meetingId, update);
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        error: expect.stringContaining('Failed to persist meeting update:'),
      });
    } finally {
      await rm(sessionsPath, { force: true, recursive: true });
    }

    const retry = await patch(meetingId, update);
    expect(retry.status).toBe(200);
    const persisted = JSON.parse(await readFile(sessionsPath, 'utf8'));
    expect(persisted.meetings[0].meeting).toMatchObject(update);
  });
});
