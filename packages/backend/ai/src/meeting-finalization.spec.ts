import { describe, expect, test, vi } from 'vitest';

import { MeetingFinalizationTracker } from './meeting-finalization.js';

describe('MeetingFinalizationTracker', () => {
  test('waits for a delayed transcript tail before a summary reads segments', async () => {
    const tracker = new MeetingFinalizationTracker();
    const transcript = ['Earlier final'];
    let releaseTail: (() => void) | undefined;
    const tailReady = new Promise<void>(resolve => {
      releaseTail = resolve;
    });

    const finalization = tracker.start('meeting-1', async () => {
      await tailReady;
      transcript.push('Delayed final tail');
    });

    const readSummaryTranscript = vi.fn(async () => {
      await tracker.wait('meeting-1');
      return transcript.join('\n');
    });
    const summaryTranscript = readSummaryTranscript();

    await Promise.resolve();
    expect(readSummaryTranscript).toHaveBeenCalledOnce();
    expect(transcript).toEqual(['Earlier final']);

    releaseTail?.();
    await expect(summaryTranscript).resolves.toBe(
      'Earlier final\nDelayed final tail'
    );
    await finalization;
  });

  test('reuses one finalization for repeated stop requests', async () => {
    const tracker = new MeetingFinalizationTracker();
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const finalize = vi.fn(async () => gate);

    const first = tracker.start('meeting-1', finalize);
    const second = tracker.start('meeting-1', finalize);

    expect(second).toBe(first);
    await Promise.resolve();
    expect(finalize).toHaveBeenCalledOnce();

    release?.();
    await Promise.all([first, second]);
  });

  test('holds shutdown until every in-flight meeting tail is finalized', async () => {
    const tracker = new MeetingFinalizationTracker();
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });

    void tracker.start('meeting-1', async () => firstGate);
    void tracker.start('meeting-2', async () => secondGate);

    let shutdownReady = false;
    const shutdown = tracker.waitAll().then(() => {
      shutdownReady = true;
    });
    await Promise.resolve();
    expect(shutdownReady).toBe(false);

    releaseFirst?.();
    await Promise.resolve();
    expect(shutdownReady).toBe(false);

    releaseSecond?.();
    await shutdown;
    expect(shutdownReady).toBe(true);
  });
});
