import { describe, expect, test } from 'vitest';

import { actionIntent, isWholeDocumentClearRequest } from './stream';

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
  });
});
