import { describe, expect, test } from 'vitest';

import {
  actionIntent,
  appendTextStreamObject,
  isWholeDocumentClearRequest,
} from './stream';
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

describe('local ONNX action intent', () => {
  test.each([
    ['Create a new note with the answer', 'create_note'],
    ['Make a checklist from these action items', 'create_task_list'],
    ['Create a mind map for this project', 'create_mindmap'],
    ['Add these rows to the current tracker', 'append_database_rows'],
    ['Create a project tracker', 'create_database'],
    ['Append this summary to the current page', 'insert_markdown'],
  ])('classifies %s', (prompt, expected) => {
    expect(actionIntent(prompt)).toBe(expected);
  });

  test.each([
    'What does this note say?',
    'Find the answer in my workspace',
    'Clear everything in this note',
    'Should I delete this old project someday?',
    "Don't delete anything in this note; just summarize it.",
    'What should I add to my plan?',
    'How do I insert a table in Nota?',
  ])('does not turn a read-only request into an edit: %s', prompt => {
    expect(actionIntent(prompt)).toBeNull();
  });

  test('recognizes only explicit whole-document clear commands for the safe refusal path', () => {
    expect(isWholeDocumentClearRequest('Clear everything in this note')).toBe(
      true
    );
    expect(
      isWholeDocumentClearRequest('Should I delete this old project someday?')
    ).toBe(false);
    expect(
      isWholeDocumentClearRequest(
        "Don't delete anything in this note; just summarize it."
      )
    ).toBe(false);
    expect(isWholeDocumentClearRequest('How do I remove it?')).toBe(false);
  });

  test('keeps polite edit requests as edits', () => {
    expect(actionIntent('Can you add this summary to the note?')).toBe(
      'insert_markdown'
    );
  });
});
