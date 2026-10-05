import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { loadConfig, saveConfig, updateConfig } from './config';
import { MeetingFallbackAudioSpool } from './meeting-audio-spool';
import { resumeRetainedMeetingTranscriptions } from './meetings';
import { requiredFilesFor } from './model-registry';
import { createServer } from './server';
import * as sherpa from './sherpa-stt';

const LEGACY_MODEL = 'nemotron-3.5-asr-streaming-int4';
const NATIVE_MODEL = 'sherpa-nemotron-3.5-streaming-560ms-int8';
let root = '';
let settingsPath = '';
let server:
  | ReturnType<ReturnType<typeof createServer>['app']['listen']>
  | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-stt-retirement-'));
  settingsPath = path.join(root, '.nota', 'ai-settings.json');
  await mkdir(path.dirname(settingsPath), { recursive: true });
  vi.stubEnv('NOTA_AI_WORKSPACE_ROOT', root);
  vi.stubEnv('NOTA_AI_SETTINGS_PATH', settingsPath);
  vi.stubEnv('NOTA_AI_SEEDED_MODEL_ROOT', path.join(root, 'no-seeds'));
  vi.stubEnv('NOTA_AI_BACKEND_TOKEN', 'stt-retirement-test');
  vi.stubEnv('NOTA_MEETING_STT_PROVIDER', 'auto');
  vi.stubEnv('NOTA_MEETING_STT_MODEL', '');
});

afterEach(async () => {
  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

test.each([undefined, LEGACY_MODEL])(
  'migrates legacy environment selections with model %s',
  model => {
    vi.stubEnv('NOTA_MEETING_STT_PROVIDER', 'nemotron-onnx');
    vi.stubEnv('NOTA_MEETING_STT_MODEL', model);
    expect(loadConfig()).toMatchObject({
      meetingSttProviderId: 'nemotron-sherpa',
      meetingSttModelId: NATIVE_MODEL,
    });
  }
);

test.each([undefined, '', LEGACY_MODEL])(
  'migrates persisted legacy selections with model %s and preserves preferences',
  async modelId => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        settings: {
          meetingSttProviderId: 'nemotron-onnx',
          meetingSttModelId: modelId,
          meetingSttLanguage: 'fr-CA',
          toolsEnabled: false,
          embeddingModel: 'all-minilm-l6-v2-embedding',
        },
      })
    );
    const config = loadConfig();
    expect(config).toMatchObject({
      meetingSttProviderId: 'nemotron-sherpa',
      meetingSttModelId: NATIVE_MODEL,
      meetingSttLanguage: 'fr-CA',
      toolsEnabled: false,
      embeddingModel: 'all-minilm-l6-v2-embedding',
    });
    saveConfig(config);
    expect(
      JSON.parse(await readFile(settingsPath, 'utf8')).settings
    ).toMatchObject({
      meetingSttProviderId: 'nemotron-sherpa',
      meetingSttModelId: NATIVE_MODEL,
      meetingSttLanguage: 'fr-CA',
      toolsEnabled: false,
    });
  }
);

test('migrates a legacy model under Auto and old settings updates', async () => {
  await writeFile(
    settingsPath,
    JSON.stringify({
      settings: {
        meetingSttProviderId: 'auto',
        meetingSttModelId: LEGACY_MODEL,
      },
    })
  );
  const config = loadConfig();
  expect(config.meetingSttProviderId).toBe('auto');
  expect(config.meetingSttModelId).toBe(NATIVE_MODEL);
  updateConfig(config, {
    meetingSttProviderId: 'nemotron-onnx',
    meetingSttLanguage: 'en-US',
  });
  expect(config).toMatchObject({
    meetingSttProviderId: 'nemotron-sherpa',
    meetingSttModelId: NATIVE_MODEL,
    meetingSttLanguage: 'en-US',
  });
});

test('preserves historical meetings and recovers their retained audio through native Nemotron', async () => {
  const modelRoot = path.join(root, '.nota', 'models', NATIVE_MODEL);
  await mkdir(modelRoot, { recursive: true });
  for (const file of requiredFilesFor(NATIVE_MODEL)) {
    await writeFile(path.join(modelRoot, file), 'synthetic-model-fixture');
  }
  const legacyFile = path.join(
    root,
    '.nota',
    'models',
    LEGACY_MODEL,
    'encoder.onnx'
  );
  await mkdir(path.dirname(legacyFile), { recursive: true });
  await writeFile(legacyFile, 'user-owned-legacy-file');
  const id = 'legacy-saved-meeting';
  const sessionsPath = path.join(root, '.nota', 'meetings', 'sessions.json');
  await mkdir(path.dirname(sessionsPath), { recursive: true });
  const originalSegment = {
    id: 'saved-segment',
    meetingId: id,
    type: 'final',
    source: 'mic',
    startMs: 0,
    endMs: 1000,
    text: 'Previously saved transcript.',
    createdAt: '2026-09-01T12:00:00.000Z',
  };
  await writeFile(
    sessionsPath,
    JSON.stringify({
      version: 1,
      meetings: [
        {
          meeting: {
            id,
            providerId: 'nemotron-onnx',
            sttModelId: LEGACY_MODEL,
            sttLanguage: 'en-US',
            createdAt: originalSegment.createdAt,
            updatedAt: originalSegment.createdAt,
            summary: 'Saved summary',
            docId: 'workspace-note',
            savedTranscriptSegmentIds: [originalSegment.id],
            savedTranscriptSegmentSnapshots: {
              [originalSegment.id]: originalSegment.text,
            },
          },
          transcriptSegments: [originalSegment],
          stt: {
            providerId: 'nemotron-onnx',
            requestedProviderId: 'nemotron-onnx',
          },
        },
      ],
    })
  );
  const spool = new MeetingFallbackAudioSpool(
    path.join(path.dirname(sessionsPath), 'fallback-audio', `${id}.spool`)
  );
  await spool.append({
    id: 'retained-audio',
    durationMs: 100,
    startMs: 3500,
    endMs: 3600,
    level: 0.05,
    source: 'mic',
    sampleRate: 16000,
    pcm16: new Int16Array(1600).fill(1000),
  });
  vi.spyOn(sherpa, 'sherpaRuntimeAvailable').mockResolvedValue(true);
  const decoder = vi
    .spyOn(sherpa, 'createSherpaUtteranceDecoder')
    .mockResolvedValue({
      executionProvider: 'mock/cpu',
      supportsPartials: true,
      pushPcm16: vi.fn(),
      partial: vi.fn(async () => null),
      finish: vi.fn(async () => ({
        language: null,
        text: 'Recovered missing speech.',
      })),
    });
  const backend = createServer();
  await backend.ready;
  await resumeRetainedMeetingTranscriptions(backend.config);
  server = backend.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test address');
  const request = (url: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${address.port}${url}`, {
      ...init,
      headers: {
        'x-nota-backend-token': 'stt-retirement-test',
        ...init?.headers,
      },
    });
  const result = await (await request(`/v1/meetings/${id}/transcript`)).json();
  expect(result.meeting).toMatchObject({
    providerId: 'nemotron-onnx',
    sttModelId: LEGACY_MODEL,
    summary: 'Saved summary',
    docId: 'workspace-note',
    savedTranscriptSegmentIds: [originalSegment.id],
    stt: {
      providerId: 'nemotron-sherpa',
      requestedProviderId: 'nemotron-sherpa',
    },
  });
  expect(result.transcriptSegments).toEqual([
    originalSegment,
    expect.objectContaining({
      startMs: 3500,
      endMs: 3600,
      text: 'Recovered missing speech.',
    }),
  ]);
  expect(decoder).toHaveBeenCalledWith('nemotron-streaming', modelRoot, {
    language: 'en-US',
  });
  expect(await spool.hasChunks()).toBe(false);
  expect(await readFile(legacyFile, 'utf8')).toBe('user-owned-legacy-file');
  const persisted = JSON.parse(await readFile(sessionsPath, 'utf8'))
    .meetings[0];
  expect(persisted.meeting.providerId).toBe('nemotron-onnx');
  expect(persisted.transcriptSegments).toHaveLength(2);
  const providers = await (await request('/v1/stt/providers')).json();
  expect(
    providers.providers.some(
      (provider: { id: string }) => provider.id === 'nemotron-onnx'
    )
  ).toBe(false);
  const fileTranscription = await request('/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: NATIVE_MODEL,
      sampleRate: 16000,
      pcm16Base64: Buffer.from(new Int16Array(1600).buffer).toString('base64'),
    }),
  });
  expect(fileTranscription.status).toBe(200);
  expect(await fileTranscription.json()).toMatchObject({
    model: NATIVE_MODEL,
    text: 'Recovered missing speech.',
  });
  const download = await request(`/v1/local/models/${LEGACY_MODEL}/download`, {
    method: 'POST',
  });
  expect(download.status).toBe(404);
});
