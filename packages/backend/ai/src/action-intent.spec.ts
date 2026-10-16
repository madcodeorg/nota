import { describe, expect, test } from 'vitest';

import { appendTextStreamObject } from './stream';
import type { StreamObject } from './types';

describe('saved stream object order', () => {
  test('merges adjacent deltas and keeps text after tool cards', () => {
    const objects: StreamObject[] = [];
    appendTextStreamObject(objects, 'Let me ');
    appendTextStreamObject(objects, 'check.');
    appendTextStreamObject(objects, 'thinking', 'reasoning');
    appendTextStreamObject(objects, ' more', 'reasoning');
    objects.push({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'search_nota_workspace',
      args: { query: 'plan' },
    });
    appendTextStreamObject(objects, 'Found it.');
    appendTextStreamObject(objects, '');

    expect(objects).toEqual([
      { type: 'text-delta', textDelta: 'Let me check.' },
      { type: 'reasoning', textDelta: 'thinking more' },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'search_nota_workspace',
        args: { query: 'plan' },
      },
      { type: 'text-delta', textDelta: 'Found it.' },
    ]);
  });
});
