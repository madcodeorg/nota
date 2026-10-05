import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SystemAudioRecoveryJournal } from '../../src/main/recording/system-audio-recovery';

const temporaryDirectories: string[] = [];

function recoveryFixture() {
  const recordings = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nota-system-recovery-')
  );
  temporaryDirectories.push(recordings);
  const journals = path.join(recordings, 'meeting-recovery');
  const rawPath = path.join(recordings, 'unknown-7-100.raw');
  fs.writeFileSync(rawPath, Buffer.alloc(32, 1));
  return {
    journals,
    rawPath,
    store: new SystemAudioRecoveryJournal(journals, recordings),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('system audio crash recovery journal', () => {
  it('journals ownership before the native archive path exists', () => {
    const recordings = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nota-system-recovery-before-tap-')
    );
    temporaryDirectories.push(recordings);
    const journals = path.join(recordings, 'meeting-recovery');
    const rawPath = path.join(recordings, 'unknown-7-100.raw');
    const store = new SystemAudioRecoveryJournal(journals, recordings);

    expect(
      store.begin({
        meetingId: 'meeting-before-tap',
        rawPath,
        recordingId: 7,
        startTime: 100,
        workspaceId: 'workspace-1',
      })
    ).toBeNull();
    expect(fs.readdirSync(journals)).toHaveLength(1);

    fs.writeFileSync(rawPath, Buffer.alloc(32, 1));
    expect(store.updateFormat(7, 2, 48_000, 100)).toBe(true);
    expect(store.latest()).toMatchObject({
      meetingId: 'meeting-before-tap',
      numberOfChannels: 2,
      sampleRate: 48_000,
    });
  });

  it('does not attach a reused native recording id to older ownership', () => {
    const fixture = recoveryFixture();
    fixture.store.begin({
      meetingId: 'meeting-old-native-id',
      rawPath: fixture.rawPath,
      recordingId: 7,
      startTime: 100,
      workspaceId: 'workspace-1',
    });

    expect(fixture.store.updateFormat(7, 1, 44_100, 200)).toBe(false);
    expect(fixture.store.latest()).toMatchObject({
      numberOfChannels: null,
      sampleRate: null,
    });
    expect(fixture.store.updateFormat(7, 2, 48_000, 100)).toBe(true);
  });

  it('completes the normal begin-format-stop-publish-release lifecycle', async () => {
    const fixture = recoveryFixture();
    fixture.store.begin({
      meetingId: 'meeting-normal-stop',
      rawPath: fixture.rawPath,
      recordingId: 7,
      startTime: 100,
      workspaceId: 'workspace-1',
    });
    expect(fixture.store.updateFormat(7, 2, 48_000)).toBe(true);
    expect(fixture.store.markStopped(7, 32)).toBe(true);
    const filepath = await fixture.store.publishPortable(
      7,
      new Uint8Array([1, 2, 3])
    );
    expect(fixture.store.release(7, 'meeting-normal-stop')).toBe(true);
    expect(fixture.store.latest()).toBeNull();
    expect(fs.existsSync(fixture.rawPath)).toBe(false);
    expect(fs.existsSync(filepath ?? '')).toBe(true);
  });

  it('preserves ownership and raw bytes when capture dies before format append', async () => {
    const fixture = recoveryFixture();
    fixture.store.begin({
      meetingId: 'meeting-before-format',
      rawPath: fixture.rawPath,
      recordingId: 7,
      startTime: 100,
      workspaceId: 'workspace-1',
    });

    const restarted = new SystemAudioRecoveryJournal(
      fixture.journals,
      path.dirname(fixture.journals)
    );
    expect(restarted.latest()).toMatchObject({
      filepath: fixture.rawPath,
      meetingId: 'meeting-before-format',
      numberOfChannels: null,
      recordingId: 7,
      sampleRate: null,
      status: 'stopped',
      workspaceId: 'workspace-1',
    });
    await expect(
      restarted.publishPortable(7, new Uint8Array([1]))
    ).rejects.toThrow('missing its native audio format');
    expect(() => restarted.release(7, 'meeting-before-format')).toThrow(
      'cannot be released before portable publication'
    );
    expect(fs.existsSync(fixture.rawPath)).toBe(true);
    expect(restarted.latest()).not.toBeNull();
  });

  it('rehydrates format and ownership after a crash before normal stop', () => {
    const fixture = recoveryFixture();
    fixture.store.begin({
      meetingId: 'meeting-before-stop',
      rawPath: fixture.rawPath,
      recordingId: 7,
      startTime: 100,
      workspaceId: 'workspace-1',
    });
    fixture.store.updateFormat(7, 2, 48_000);

    const restarted = new SystemAudioRecoveryJournal(
      fixture.journals,
      path.dirname(fixture.journals)
    );
    expect(restarted.findByMeetingId('meeting-before-stop')).toMatchObject({
      archiveBytes: 32,
      filepath: fixture.rawPath,
      numberOfChannels: 2,
      sampleRate: 48_000,
      status: 'stopped',
    });
  });

  it('reuses portable publication after a crash before metadata confirmation', async () => {
    const fixture = recoveryFixture();
    fixture.store.begin({
      meetingId: 'meeting-before-metadata',
      rawPath: fixture.rawPath,
      recordingId: 7,
      startTime: 100,
      workspaceId: 'workspace-1',
    });
    fixture.store.updateFormat(7, 2, 48_000);
    fixture.store.markStopped(7, 32);

    const filepath = await fixture.store.publishPortable(
      7,
      new Uint8Array([1, 2, 3])
    );
    expect(filepath).toMatch(/\.opus$/);
    expect(fs.existsSync(fixture.rawPath)).toBe(false);

    const restarted = new SystemAudioRecoveryJournal(
      fixture.journals,
      path.dirname(fixture.journals)
    );
    expect(restarted.latest()).toMatchObject({
      filepath,
      recordingId: 7,
      status: 'ready',
    });
    expect(restarted.release(7)).toBe(true);
    expect(restarted.latest()).toBeNull();
    expect(fs.existsSync(filepath ?? '')).toBe(true);
  });

  it('cleans retained raw audio after ready was journaled before unlink', () => {
    const fixture = recoveryFixture();
    fixture.store.begin({
      meetingId: 'meeting-after-ready-before-unlink',
      rawPath: fixture.rawPath,
      recordingId: 7,
      startTime: 100,
      workspaceId: 'workspace-1',
    });
    fixture.store.updateFormat(7, 2, 48_000);
    fixture.store.markStopped(7, 32);
    const filepath = fixture.rawPath.replace(/\.raw$/i, '.opus');
    fs.writeFileSync(filepath, Buffer.from([1, 2, 3]));
    const [journalName] = fs.readdirSync(fixture.journals);
    fs.appendFileSync(
      path.join(fixture.journals, journalName),
      `${JSON.stringify({ filepath, type: 'ready' })}\n`
    );

    const restarted = new SystemAudioRecoveryJournal(
      fixture.journals,
      path.dirname(fixture.journals)
    );
    expect(restarted.latest()).toMatchObject({
      filepath,
      rawPath: fixture.rawPath,
      status: 'ready',
    });
    expect(restarted.release(7, 'meeting-after-ready-before-unlink')).toBe(
      true
    );
    expect(fs.existsSync(fixture.rawPath)).toBe(false);
    expect(fs.existsSync(filepath)).toBe(true);
    expect(restarted.latest()).toBeNull();
  });
});
