import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/main/ai-backend', () => ({
  fetchAiBackend: (requestPath: string, init?: RequestInit) =>
    globalThis.fetch(`http://127.0.0.1:3010${requestPath}`, init),
}));

vi.mock('../../src/main/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  forwardAudioSamples,
  startMeetingAudioForward,
  stopAudioForwardForRecording,
  stopMeetingAudioForward,
} from '../../src/main/recording/audio-forward';

const temporaryDirectories: string[] = [];

function rawArchive() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nota-audio-forward-')
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'meeting.raw');
  fs.writeFileSync(filePath, Buffer.alloc(0));
  return filePath;
}

function pcmBuffer(samples: Float32Array) {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function successfulResponse() {
  return new Response(null, { status: 204 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('system audio forwarding', () => {
  it('retries an accepted batch byte-for-byte before forwarding newer audio', async () => {
    vi.useFakeTimers();
    const first = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const newer = new Float32Array([0.5, 0.6]);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => {
        // Model a response being lost after the backend accepted the frame.
        // New native samples arrive while that first POST is in flight.
        forwardAudioSamples(10, newer);
        return Promise.reject(new Error('response lost'));
      })
      .mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      channels: 1,
      meetingId: 'transient-meeting',
      recordingId: 10,
      sampleRate: 8000,
    });
    forwardAudioSamples(10, first);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
    expect(fetchMock.mock.calls[0][1]?.body).toEqual(
      fetchMock.mock.calls[1][1]?.body
    );
    expect(fetchMock.mock.calls[1][1]?.body).toEqual(pcmBuffer(first));
    expect(
      new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('frameId')
    ).toBe(`system:0:${first.byteLength}`);
    expect(
      new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('frameId')
    ).toBe(`system:${first.byteLength}:${first.byteLength + newer.byteLength}`);
    expect(fetchMock.mock.calls[2][1]?.body).toEqual(pcmBuffer(newer));

    await expect(stopMeetingAudioForward('transient-meeting')).resolves.toEqual(
      {
        archive: first.byteLength + newer.byteLength,
        complete: true,
        cursor: first.byteLength + newer.byteLength,
        reason: null,
      }
    );
  });

  it('preserves an incomplete drain so a second Stop can finish the exact retry', async () => {
    vi.useFakeTimers();
    const first = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const newer = new Float32Array([0.5, 0.6]);
    let queuedNewerAudio = false;
    const fetchMock = vi.fn().mockImplementation(() => {
      if (!queuedNewerAudio) {
        queuedNewerAudio = true;
        // The backend may have accepted this first frame even though its
        // response never reached Nota. Keep newer audio out of its retry.
        forwardAudioSamples(14, newer);
      }
      return Promise.reject(new Error('response lost'));
    });
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      channels: 1,
      meetingId: 'retry-stop-meeting',
      recordingId: 14,
      sampleRate: 8000,
    });
    forwardAudioSamples(14, first);

    await vi.advanceTimersByTimeAsync(100);
    const incomplete = await stopAudioForwardForRecording(14);
    expect(incomplete).toMatchObject({
      archive: first.byteLength + newer.byteLength,
      complete: false,
      cursor: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(call[0]).toBe(fetchMock.mock.calls[0][0]);
      expect(call[1]?.body).toEqual(fetchMock.mock.calls[0][1]?.body);
    }

    fetchMock.mockResolvedValue(successfulResponse());
    await expect(
      stopMeetingAudioForward('retry-stop-meeting')
    ).resolves.toEqual({
      archive: first.byteLength + newer.byteLength,
      complete: true,
      cursor: first.byteLength + newer.byteLength,
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[4][0]).toBe(fetchMock.mock.calls[0][0]);
    expect(fetchMock.mock.calls[4][1]?.body).toEqual(
      fetchMock.mock.calls[0][1]?.body
    );
    expect(
      new URL(String(fetchMock.mock.calls[5][0])).searchParams.get('frameId')
    ).toBe(`system:${first.byteLength}:${first.byteLength + newer.byteLength}`);
    expect(fetchMock.mock.calls[5][1]?.body).toEqual(pcmBuffer(newer));
  });

  it('recovers from repeated live post failures using the raw archive', async () => {
    vi.useFakeTimers();
    const filePath = rawArchive();
    const first = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const newer = new Float32Array([0.5, 0.6]);
    let queuedNewerAudio = false;
    const fetchMock = vi.fn().mockImplementation(() => {
      if (!queuedNewerAudio) {
        queuedNewerAudio = true;
        forwardAudioSamples(11, newer);
      }
      return Promise.reject(new Error('backend offline'));
    });
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      archiveBytes: 0,
      channels: 1,
      filePath,
      fromByte: 0,
      meetingId: 'repeated-failure-meeting',
      recordingId: 11,
      sampleRate: 8000,
    });
    forwardAudioSamples(11, first);

    await vi.advanceTimersByTimeAsync(100);
    fs.writeFileSync(
      filePath,
      Buffer.concat([pcmBuffer(first), pcmBuffer(newer)])
    );
    await vi.advanceTimersByTimeAsync(4900);
    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(fetchMock.mock.calls[49][0]).toBe(fetchMock.mock.calls[0][0]);
    expect(fetchMock.mock.calls[49][1]?.body).toEqual(
      fetchMock.mock.calls[0][1]?.body
    );
    fetchMock.mockResolvedValue(successfulResponse());

    const result = await stopAudioForwardForRecording(11);
    expect(result).toMatchObject({
      archive: first.byteLength + newer.byteLength,
      complete: true,
      cursor: first.byteLength + newer.byteLength,
    });
    expect(result?.reason).toContain('repeated post failures');
    expect(fetchMock).toHaveBeenCalledTimes(52);
    expect(fetchMock.mock.calls[50][0]).toBe(fetchMock.mock.calls[0][0]);
    expect(fetchMock.mock.calls[50][1]?.body).toEqual(
      fetchMock.mock.calls[0][1]?.body
    );
    expect(
      new URL(String(fetchMock.mock.calls[51][0])).searchParams.get('frameId')
    ).toBe(`system:${first.byteLength}:${first.byteLength + newer.byteLength}`);
    expect(fetchMock.mock.calls[51][1]?.body).toEqual(pcmBuffer(newer));
  });

  it('switches an overflowing live queue to archive recovery without advancing the cursor', async () => {
    const filePath = rawArchive();
    const samples = new Float32Array(8000 * 30 + 1);
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      archiveBytes: 0,
      channels: 1,
      filePath,
      fromByte: 0,
      meetingId: 'overflow-meeting',
      recordingId: 12,
      sampleRate: 8000,
    });
    forwardAudioSamples(12, samples);
    fs.writeFileSync(filePath, pcmBuffer(samples));

    const result = await stopAudioForwardForRecording(12);
    expect(result).toMatchObject({
      archive: samples.byteLength,
      complete: true,
      cursor: samples.byteLength,
    });
    expect(result?.reason).toContain('live queue overflow');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('backfills the final archive tail after native capture stops', async () => {
    vi.useFakeTimers();
    const filePath = rawArchive();
    const first = new Float32Array(8000);
    const tail = new Float32Array(4000);
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      archiveBytes: 0,
      channels: 1,
      filePath,
      fromByte: 0,
      meetingId: 'final-tail-meeting',
      recordingId: 13,
      sampleRate: 8000,
    });
    forwardAudioSamples(13, first);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledOnce();

    forwardAudioSamples(13, tail);
    fs.writeFileSync(
      filePath,
      Buffer.concat([pcmBuffer(first), pcmBuffer(tail)])
    );

    const result = await stopAudioForwardForRecording(13);
    expect(result).toEqual({
      archive: first.byteLength + tail.byteLength,
      complete: true,
      cursor: first.byteLength + tail.byteLength,
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = fetchMock.mock.calls[0][1]?.body as Buffer;
    const tailBody = fetchMock.mock.calls[1][1]?.body as Buffer;
    expect(firstBody.byteLength).toBe(first.byteLength);
    expect(tailBody.byteLength).toBe(tail.byteLength);
    expect(String(fetchMock.mock.calls[1][0])).toContain('startMs=1000');
    expect(
      new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('frameId')
    ).toBe(`system:${first.byteLength}:${first.byteLength + tail.byteLength}`);
  });

  it('streams initial archive backfill in bounded chronological posts', async () => {
    const filePath = rawArchive();
    const postMaxBytes = 1024 * 1024;
    const samples = new Float32Array(
      (postMaxBytes * 2 + 16_000) / Float32Array.BYTES_PER_ELEMENT
    );
    samples.fill(0.25);
    fs.writeFileSync(filePath, pcmBuffer(samples));
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    startMeetingAudioForward({
      archiveBytes: samples.byteLength,
      channels: 1,
      filePath,
      fromByte: 0,
      meetingId: 'initial-backfill-meeting',
      recordingId: 15,
      sampleRate: 8000,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    let expectedStart = 0;
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]));
      const body = call[1]?.body as Buffer;
      expect(body.byteLength).toBeLessThanOrEqual(postMaxBytes);
      expect(url.searchParams.get('frameId')).toBe(
        `system:${expectedStart}:${expectedStart + body.byteLength}`
      );
      expectedStart += body.byteLength;
    }
    expect(expectedStart).toBe(samples.byteLength);

    await expect(stopAudioForwardForRecording(15)).resolves.toEqual({
      archive: samples.byteLength,
      complete: true,
      cursor: samples.byteLength,
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
