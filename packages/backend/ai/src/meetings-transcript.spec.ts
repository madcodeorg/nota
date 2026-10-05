import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  discardMeetingFallbackAudioAfterRecovery,
  fallbackAudioChunksWithoutTranscriptCoverage,
  firstSuccessfulMeetingSttModel,
} from './meetings.js';
import { createServer } from './server.js';

const TOKEN = 'meeting-transcript-test-token';
const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  seededModelRoot: process.env.NOTA_AI_SEEDED_MODEL_ROOT,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

let workspaceRoot = '';
let baseUrl = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-transcript-'));
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

function pcmBody(samples: Float32Array) {
  const body = new ArrayBuffer(samples.byteLength);
  new Uint8Array(body).set(
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  );
  return body;
}

async function postAudioFrame(input: {
  endMs: number;
  frameId: string;
  meetingId: string;
  samples: Float32Array;
  startMs: number;
}) {
  return request(
    `/v1/meetings/${input.meetingId}/audio-frame?${new URLSearchParams({
      channels: '1',
      endMs: String(input.endMs),
      frameId: input.frameId,
      sampleRate: '16000',
      source: 'mic',
      startMs: String(input.startMs),
    }).toString()}`,
    {
      body: pcmBody(input.samples),
      headers: { 'content-type': 'application/octet-stream' },
      method: 'POST',
    }
  );
}

async function spoolOneVadChunk(meetingId: string) {
  const speech = new Float32Array(8_000);
  speech.fill(0.2);
  const silence = new Float32Array(8_000);
  const speechResponse = await postAudioFrame({
    endMs: 500,
    frameId: `mic:${meetingId}:speech`,
    meetingId,
    samples: speech,
    startMs: 0,
  });
  expect(speechResponse.ok).toBe(true);
  const silenceResponse = await postAudioFrame({
    endMs: 1_000,
    frameId: `mic:${meetingId}:silence`,
    meetingId,
    samples: silence,
    startMs: 500,
  });
  expect(silenceResponse.ok).toBe(true);
  expect(await silenceResponse.json()).toMatchObject({
    chunk: { endMs: 1_000, source: 'mic', startMs: 0 },
  });
  return path.join(
    workspaceRoot,
    '.nota',
    'meetings',
    'fallback-audio',
    `${meetingId}.spool.mic`
  );
}

describe('meeting transcript integrity', () => {
  test('only treats a complete per-source final as fallback audio coverage', () => {
    const chunk = {
      durationMs: 1_000,
      endMs: 1_000,
      id: 'speech-1',
      level: 0.2,
      pcm16: new Int16Array(16_000),
      sampleRate: 16000 as const,
      source: 'mic' as const,
      startMs: 0,
    };
    const segment = {
      createdAt: '2026-07-16T00:00:00.000Z',
      endMs: 1_000,
      id: 'final-1',
      meetingId: 'meeting-1',
      source: 'mic' as const,
      startMs: 0,
      text: 'Complete utterance',
      type: 'final' as const,
    };

    expect(
      fallbackAudioChunksWithoutTranscriptCoverage([chunk], [segment])
    ).toEqual([]);
    expect(
      fallbackAudioChunksWithoutTranscriptCoverage(
        [chunk],
        [{ ...segment, endMs: 500 }]
      )
    ).toEqual([chunk]);
  });

  test('keeps simultaneous nondominant-source audio while deduping the covered source', () => {
    const micChunk = {
      durationMs: 1_000,
      endMs: 1_000,
      id: 'mic-speech',
      level: 0.2,
      pcm16: new Int16Array(16_000),
      sampleRate: 16000 as const,
      source: 'mic' as const,
      startMs: 0,
    };
    const systemChunk = {
      ...micChunk,
      id: 'system-speech',
      source: 'system' as const,
    };
    const dominantMicFinal = {
      createdAt: '2026-07-16T00:00:00.000Z',
      endMs: 1_000,
      id: 'mixed-final',
      meetingId: 'meeting-1',
      source: 'mic' as const,
      startMs: 0,
      text: 'Dominant microphone utterance',
      type: 'final' as const,
    };

    expect(
      fallbackAudioChunksWithoutTranscriptCoverage(
        [micChunk, systemChunk],
        [dominantMicFinal]
      )
    ).toEqual([systemChunk]);
    expect(
      fallbackAudioChunksWithoutTranscriptCoverage(
        [micChunk, systemChunk],
        [
          {
            ...dominantMicFinal,
            id: 'mixed-system-final',
            source: 'system',
          },
        ]
      )
    ).toEqual([micChunk]);

    // Replayed or overlapping durable audio from the same source remains
    // covered and does not create duplicate transcript text.
    expect(
      fallbackAudioChunksWithoutTranscriptCoverage(
        [micChunk, { ...micChunk, id: 'mic-replay' }],
        [dominantMicFinal]
      )
    ).toEqual([]);
  });

  test.each([
    { endMs: 1_000, startMs: 900 },
    { endMs: 1_200, startMs: 1_100 },
    { endMs: 1_250, startMs: 1_150 },
    { endMs: 1_050, startMs: 1_050 },
  ])(
    'retains short speech without positive overlap with $startMs-$endMs',
    timestamps => {
      const chunk = {
        durationMs: 100,
        endMs: 1_100,
        id: 'short-speech',
        level: 0.2,
        pcm16: new Int16Array(1_600),
        sampleRate: 16000 as const,
        source: 'mic' as const,
        startMs: 1_000,
      };
      const segment = {
        ...timestamps,
        createdAt: '2026-09-13T00:00:00.000Z',
        id: 'nearby-final',
        meetingId: 'meeting-1',
        source: 'mic' as const,
        text: 'Another utterance',
        type: 'final' as const,
      };
      expect(
        fallbackAudioChunksWithoutTranscriptCoverage([chunk], [segment])
      ).toEqual([chunk]);
      expect(
        fallbackAudioChunksWithoutTranscriptCoverage(
          [chunk],
          [{ ...segment, endMs: chunk.endMs, startMs: chunk.startMs }]
        )
      ).toEqual([]);
    }
  );

  test('falls through from a failed primary decoder to bundled recovery', async () => {
    const modelIds = ['nemotron', 'whisper-tiny'];
    const attempts: string[] = [];

    await expect(
      firstSuccessfulMeetingSttModel({
        execute: async modelId => {
          attempts.push(modelId);
          if (modelId === 'nemotron') {
            throw new Error('runtime failed');
          }
          return 'Recovered transcript';
        },
        modelIds,
      })
    ).resolves.toEqual({
      modelId: 'whisper-tiny',
      value: 'Recovered transcript',
    });
    expect(attempts).toEqual(['nemotron', 'whisper-tiny']);
    expect(modelIds).toEqual(['whisper-tiny']);
  });

  test('retains the recovery path when a decoder returns empty text', async () => {
    const modelIds = ['nemotron', 'whisper-tiny'];
    const attempts: string[] = [];

    await expect(
      firstSuccessfulMeetingSttModel({
        execute: async modelId => {
          attempts.push(modelId);
          return modelId === 'nemotron' ? '   ' : 'Recovered transcript';
        },
        modelIds,
      })
    ).resolves.toEqual({
      modelId: 'whisper-tiny',
      value: 'Recovered transcript',
    });
    expect(attempts).toEqual(['nemotron', 'whisper-tiny']);
    expect(modelIds).toEqual(['whisper-tiny']);
  });

  test('does not discard durable audio while any transcript gap is unresolved', async () => {
    const discard = vi.fn(async () => {});

    await expect(
      discardMeetingFallbackAudioAfterRecovery({
        fallbackAudioSpool: { discard },
        unresolvedGroups: 1,
      })
    ).rejects.toThrow('1 captured speech gap produced no transcript');
    expect(discard).not.toHaveBeenCalled();
  });

  test('accepts a deterministic audio frame only once after a lost acknowledgement', async () => {
    const start = await request('/v1/meetings/start', {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(start.ok).toBe(true);
    const started = (await start.json()) as { meeting: { id: string } };
    const samples = new Float32Array(4_800);
    const framePath =
      `/v1/meetings/${started.meeting.id}/audio-frame?` +
      new URLSearchParams({
        channels: '1',
        endMs: '100',
        frameId: `mic:0:100:${samples.byteLength}`,
        sampleRate: '48000',
        source: 'mic',
        startMs: '0',
      }).toString();
    const body = pcmBody(samples);

    const first = await request(framePath, {
      body,
      headers: { 'content-type': 'application/octet-stream' },
      method: 'POST',
    });
    expect(first.ok).toBe(true);
    expect(await first.json()).toMatchObject({
      audioFrames: 1,
      duplicate: false,
    });

    const replay = await request(framePath, {
      body,
      headers: { 'content-type': 'application/octet-stream' },
      method: 'POST',
    });
    expect(replay.ok).toBe(true);
    expect(await replay.json()).toMatchObject({
      audioFrames: 1,
      duplicate: true,
    });

    const stop = await request(`/v1/meetings/${started.meeting.id}/stop`, {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(stop.ok).toBe(true);
  });

  test('keeps repeated final utterances when their timestamps do not overlap', async () => {
    const start = await request('/v1/meetings/start', {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(start.ok).toBe(true);
    const started = (await start.json()) as { meeting: { id: string } };

    for (const segment of [
      { endMs: 300, id: 'yes-1', startMs: 0 },
      { endMs: 1_300, id: 'yes-2', startMs: 1_000 },
    ]) {
      const response = await request(
        `/v1/meetings/${started.meeting.id}/transcript`,
        {
          body: JSON.stringify({
            ...segment,
            language: 'fr',
            source: 'mic',
            text: 'yes',
            type: 'final',
          }),
          method: 'POST',
        }
      );
      expect(response.ok).toBe(true);
    }

    const transcript = await request(
      `/v1/meetings/${started.meeting.id}/transcript`
    );
    expect(transcript.ok).toBe(true);
    const body = (await transcript.json()) as {
      meeting: { stt: { detectedLanguage: string | null } };
      transcriptSegments: Array<{
        id: string;
        language?: string;
        text: string;
      }>;
    };
    expect(body.transcriptSegments).toMatchObject([
      { id: 'yes-1', language: 'fr', text: 'yes' },
      { id: 'yes-2', language: 'fr', text: 'yes' },
    ]);
    expect(body.meeting.stt.detectedLanguage).toBe('fr');

    const stop = await request(`/v1/meetings/${started.meeting.id}/stop`, {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(stop.ok).toBe(true);

    const canonicalMarkdown =
      '# Saved meeting note\n\nRenderer-owned content must remain searchable.';
    const indexCanonicalNote = await request('/v1/workspace/content/upsert', {
      body: JSON.stringify({
        documents: [
          {
            accessVerified: true,
            docId: 'saved-meeting-note',
            markdown: canonicalMarkdown,
            source: 'doc',
            title: 'Saved meeting note',
            visibility: 'workspace',
          },
        ],
        workspaceId: 'local',
      }),
      method: 'POST',
    });
    expect(indexCanonicalNote.ok).toBe(true);

    const link = await request(`/v1/meetings/${started.meeting.id}`, {
      body: JSON.stringify({
        docId: 'saved-meeting-note',
        microphoneRecordingPath: '/tmp/meeting-microphone.opus',
        savedTranscriptSegmentIds: ['yes-1', 'missing-id', 'yes-2'],
      }),
      method: 'PATCH',
    });
    expect(link.ok).toBe(true);
    expect(await link.json()).toMatchObject({
      meeting: {
        docId: 'saved-meeting-note',
        microphoneRecordingPath: '/tmp/meeting-microphone.opus',
        savedTranscriptSegmentIds: ['yes-1', 'yes-2'],
        transcriptSaveInitialized: true,
      },
    });

    const indexedContent = JSON.parse(
      await readFile(
        path.join(workspaceRoot, '.nota', 'search', 'workspace-content.json'),
        'utf8'
      )
    ) as {
      documents: Array<{ docId: string; markdown: string; title: string }>;
    };
    expect(
      indexedContent.documents.find(
        document => document.docId === 'saved-meeting-note'
      )
    ).toMatchObject({
      markdown: canonicalMarkdown,
      title: 'Saved meeting note',
    });
    expect(indexedContent.documents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ docId: `meeting:${started.meeting.id}` }),
      ])
    );

    const reloaded = await request(`/v1/meetings/${started.meeting.id}`);
    expect(reloaded.ok).toBe(true);
    expect(await reloaded.json()).toMatchObject({
      meeting: {
        savedTranscriptSegmentIds: ['yes-1', 'yes-2'],
        transcriptSaveInitialized: true,
      },
    });
  });

  test('retains fallback audio after a live final until stop verifies the meeting', async () => {
    const start = await request('/v1/meetings/start', {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(start.ok).toBe(true);
    const started = (await start.json()) as { meeting: { id: string } };
    const spoolPath = await spoolOneVadChunk(started.meeting.id);
    await expect(access(spoolPath)).resolves.toBeUndefined();

    const transcript = await request(
      `/v1/meetings/${started.meeting.id}/transcript`,
      {
        body: JSON.stringify({
          endMs: 1_000,
          id: 'live-final',
          source: 'mic',
          startMs: 0,
          text: 'A durable live transcript.',
          type: 'final',
        }),
        method: 'POST',
      }
    );
    expect(transcript.ok).toBe(true);
    await expect(access(spoolPath)).resolves.toBeUndefined();

    const stop = await request(`/v1/meetings/${started.meeting.id}/stop`, {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(stop.ok).toBe(true);
  });

  test('retains fallback audio when the final decoder is unavailable', async () => {
    const start = await request('/v1/meetings/start', {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(start.ok).toBe(true);
    const started = (await start.json()) as { meeting: { id: string } };
    const spoolPath = await spoolOneVadChunk(started.meeting.id);

    const stop = await request(`/v1/meetings/${started.meeting.id}/stop`, {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(stop.ok).toBe(true);
    const stopped = (await stop.json()) as {
      meeting: { stt: { message: string } };
    };
    expect(stopped.meeting.stt.message).toContain(
      'captured speech remains on disk for retry'
    );
    await expect(access(spoolPath)).resolves.toBeUndefined();

    const retry = await request(`/v1/meetings/${started.meeting.id}/stop`, {
      body: JSON.stringify({}),
      method: 'POST',
    });
    expect(retry.ok).toBe(true);
    const retried = (await retry.json()) as {
      meeting: { stt: { message: string } };
    };
    expect(retried.meeting.stt.message).toContain(
      'captured speech remains on disk for retry'
    );
    await expect(access(spoolPath)).resolves.toBeUndefined();
  });
});
