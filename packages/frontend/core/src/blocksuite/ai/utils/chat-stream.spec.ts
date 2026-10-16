import { describe, expect, test } from 'vitest';

import { notaToolView } from '../components/ai-tools/nota-tool-view';
import { formatSourceCitations } from './source-citations';
import {
  appendStreamChunk,
  groupToolSteps,
  mergeStreamObjects,
} from './stream-objects';

describe('appendStreamChunk', () => {
  test('keeps plain text in content until a stream object arrives', () => {
    let answer = appendStreamChunk({ content: '' }, 'Hello');
    answer = appendStreamChunk(answer, ' there');
    expect(answer).toEqual({ content: 'Hello there' });
  });

  test('keeps text and tool calls in arrival order once objects exist', () => {
    const toolCall = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'search_nota_workspace',
      args: { query: 'roadmap' },
    } as const;
    let answer = appendStreamChunk({ content: '' }, 'Let me look. ');
    answer = appendStreamChunk(answer, JSON.stringify(toolCall));
    answer = appendStreamChunk(answer, 'Found it.');

    expect(answer.content).toBe('Let me look. Found it.');
    expect(answer.streamObjects).toEqual([
      { type: 'text-delta', textDelta: 'Let me look. ' },
      toolCall,
      { type: 'text-delta', textDelta: 'Found it.' },
    ]);
  });

  test('treats non-object JSON-looking text as plain text', () => {
    const answer = appendStreamChunk({ content: '' }, '{"not": "an object"}');
    expect(answer).toEqual({ content: '{"not": "an object"}' });
  });
});

const toolResult = (id: string) =>
  ({
    type: 'tool-result',
    toolCallId: id,
    toolName: 'web_crawl',
    args: {},
    result: {},
  }) as const;

describe('mergeStreamObjects', () => {
  test('replaces saved parallel tool calls with their results', () => {
    const call = (id: string) =>
      ({
        type: 'tool-call',
        toolCallId: id,
        toolName: 'web_crawl',
        args: {},
      }) as const;
    const result = toolResult;

    expect(
      mergeStreamObjects([call('a'), call('b'), result('b'), result('a')])
    ).toEqual([result('a'), result('b')]);
  });
});

describe('groupToolSteps', () => {
  const step = toolResult;
  const text = (textDelta: string) =>
    ({ type: 'text-delta', textDelta }) as const;
  const isStep = (data: { type: string }) => data.type === 'tool-result';

  test('groups consecutive steps across hidden reasoning', () => {
    expect(
      groupToolSteps(
        [
          step('a'),
          { type: 'reasoning', textDelta: 'thinking' },
          step('b'),
          text('Answer'),
          step('c'),
        ],
        isStep
      )
    ).toEqual([
      { kind: 'steps', items: [step('a'), step('b')] },
      { kind: 'object', data: text('Answer') },
      { kind: 'steps', items: [step('c')] },
    ]);
  });

  test('blank text does not split a group', () => {
    expect(groupToolSteps([step('a'), text('\n'), step('b')], isStep)).toEqual([
      { kind: 'steps', items: [step('a'), step('b')] },
    ]);
  });
});

describe('formatSourceCitations', () => {
  const resolver = {
    getDocMeta: (docId: string) => (docId === 'doc-1' ? {} : null),
    getTitle: (docId: string) => (docId === 'doc-1' ? 'Roadmap' : ''),
  };

  test('replaces internal source refs with the note title', () => {
    expect(
      formatSourceCitations(
        'Launch is in May [source: nota://ws-1/doc-1#line:3-4].',
        resolver
      )
    ).toBe('Launch is in May (Roadmap).');
  });

  test('drops refs that are unknown or already titled on the line', () => {
    expect(
      formatSourceCitations('- Roadmap [source: doc-1#block-2]', resolver)
    ).toBe('- Roadmap');
    expect(formatSourceCitations('Fact [source: missing-doc]', resolver)).toBe(
      'Fact'
    );
  });

  test('leaves text without citations untouched', () => {
    expect(formatSourceCitations('No sources here.', resolver)).toBe(
      'No sources here.'
    );
  });
});

describe('notaToolView', () => {
  const docTitle = (docId: string) =>
    docId === 'doc-1' ? 'Roadmap' : undefined;

  test('describes a workspace search with titles, not ids', () => {
    const view = notaToolView(
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'search_nota_workspace',
        args: { query: 'launch' },
        result: {
          results: [
            { docId: 'doc-1', title: 'old title', snippet: 'May launch' },
            { docId: 'gone', title: 'Deleted note', snippet: '' },
          ],
        },
      },
      docTitle
    );
    expect(view.name).toBe('Found 2 matching notes for "launch"');
    expect(view.items).toEqual([
      { title: 'Roadmap', content: 'May launch', docId: 'doc-1' },
      { title: 'Deleted note', content: undefined, docId: undefined },
    ]);
  });

  test('shows progress and failures in plain language', () => {
    expect(
      notaToolView(
        {
          type: 'tool-call',
          toolCallId: 'call-2',
          toolName: 'read_nota_document',
          args: { docId: 'doc-1' },
        },
        docTitle
      ).name
    ).toBe('Reading Roadmap');
    expect(
      notaToolView(
        {
          type: 'tool-result',
          toolCallId: 'call-3',
          toolName: 'mcp_github_search',
          args: {},
          result: { status: 'error' },
        },
        docTitle
      )
    ).toEqual({ name: 'Github search failed', failed: true, items: [] });
  });
});
