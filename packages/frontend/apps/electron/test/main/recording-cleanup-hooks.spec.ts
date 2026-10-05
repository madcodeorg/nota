import { describe, expect, test } from 'vitest';

import {
  beforeRecordingStateClear,
  runBeforeRecordingStateClear,
} from '../../src/main/recording/cleanup-hooks';

describe('recording cleanup hooks', () => {
  test('holds state clear and backend shutdown until the transcript tail drains', async () => {
    const order: string[] = [];
    let releaseTail: (() => void) | undefined;
    const transcriptTail = new Promise<void>(resolve => {
      releaseTail = resolve;
    });
    const unregister = beforeRecordingStateClear(async () => {
      order.push('apple-speech:stop');
      await transcriptTail;
      order.push('apple-speech:drained');
    });

    const cleanup = (async () => {
      order.push('archive:finalized');
      await runBeforeRecordingStateClear();
      order.push('recordings:cleared');
      order.push('backend:shutdown');
    })();
    await Promise.resolve();

    expect(order).toEqual(['archive:finalized', 'apple-speech:stop']);

    releaseTail?.();
    await cleanup;
    expect(order).toEqual([
      'archive:finalized',
      'apple-speech:stop',
      'apple-speech:drained',
      'recordings:cleared',
      'backend:shutdown',
    ]);
    unregister();
  });
});
