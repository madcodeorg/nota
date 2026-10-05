// End-to-end smoke of the meeting audio path against the real server app,
// driven in-process (the sandbox blocks listening sockets). Covers:
// - POST /v1/meetings/start
// - binary octet-stream audio frames (new hot path)
// - legacy base64 JSON audio frame (compat)
// - POST /v1/meetings/:id/stop and final stt counters
import http from 'node:http';
import { PassThrough } from 'node:stream';

import { createServer } from './src/server.ts';

process.env.NOTA_AI_WORKSPACE_ROOT =
  process.env.NOTA_AI_WORKSPACE_ROOT ?? `${process.env.TMPDIR}/nota-smoke-flow`;

const { app } = createServer();

function inject({ method, url, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const socket = new PassThrough();
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = { ...headers };
    if (body) {
      req.headers['content-length'] = String(body.byteLength ?? body.length);
    }
    const res = new http.ServerResponse(req);
    let out = '';
    res.write = chunk => {
      out += chunk;
      return true;
    };
    res.end = chunk => {
      if (chunk) out += chunk;
      let parsed = null;
      try {
        parsed = JSON.parse(out);
      } catch {
        parsed = out;
      }
      resolve({ status: res.statusCode, body: parsed });
      return res;
    };
    res.on('error', reject);
    try {
      app(req, res);
      if (body) req.push(body);
      req.push(null);
    } catch (error) {
      reject(error);
    }
  });
}

const started = await inject({
  method: 'POST',
  url: '/v1/meetings/start',
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(JSON.stringify({ workspaceId: 'smoke' })),
});
if (started.status !== 200) {
  throw new Error(
    `start failed: ${started.status} ${JSON.stringify(started.body)}`
  );
}
const meetingId = started.body.meeting.id;
console.log(
  'meeting started:',
  meetingId,
  'provider:',
  started.body.meeting.providerId
);

// 5 binary frames, 100ms each of 440Hz at 48kHz mono.
const sampleRate = 48000;
const frameSamples = 4800;
for (let index = 0; index < 5; index++) {
  const pcm = new Float32Array(frameSamples);
  for (let i = 0; i < frameSamples; i++) {
    const t = (index * frameSamples + i) / sampleRate;
    pcm[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t);
  }
  const params = new URLSearchParams({
    channels: '1',
    endMs: String((index + 1) * 100),
    sampleRate: String(sampleRate),
    source: 'mic',
    startMs: String(index * 100),
  });
  const result = await inject({
    method: 'POST',
    url: `/v1/meetings/${meetingId}/audio-frame?${params}`,
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from(pcm.buffer),
  });
  if (result.status !== 200) {
    throw new Error(
      `binary frame ${index} failed: ${result.status} ${JSON.stringify(result.body)}`
    );
  }
}
console.log('binary frames accepted: 5');

// Legacy JSON base64 frame still works.
const legacy = await inject({
  method: 'POST',
  url: `/v1/meetings/${meetingId}/audio-frame`,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(
    JSON.stringify({
      channels: 1,
      encoding: 'f32le',
      endMs: 600,
      pcmBase64: Buffer.from(new Float32Array(frameSamples).buffer).toString(
        'base64'
      ),
      sampleRate,
      source: 'mic',
      startMs: 500,
    })
  ),
});
if (legacy.status !== 200) {
  throw new Error(
    `legacy frame failed: ${legacy.status} ${JSON.stringify(legacy.body)}`
  );
}
console.log(
  'legacy JSON frame accepted, total frames:',
  legacy.body.audioFrames
);
if (legacy.body.audioFrames !== 6) {
  throw new Error(`expected 6 frames, got ${legacy.body.audioFrames}`);
}

const stopped = await inject({
  method: 'POST',
  url: `/v1/meetings/${meetingId}/stop`,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from('{}'),
});
if (stopped.status !== 200) {
  throw new Error(
    `stop failed: ${stopped.status} ${JSON.stringify(stopped.body)}`
  );
}
const stt = stopped.body.meeting.stt;
console.log(
  'stopped. frames:',
  stt.audioFrames,
  'normalized:',
  stt.normalizedAudioFrames,
  'status:',
  stt.status,
  'ep:',
  stt.executionProvider,
  'rtf:',
  stt.decodeRealtimeFactor
);
if (stt.audioFrames !== 6 || stt.normalizedAudioFrames !== 6) {
  throw new Error('frame counters mismatch after stop');
}
console.log('MEETING FLOW SMOKE PASS');
process.exit(0);
