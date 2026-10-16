import { describe, expect, test, vi } from 'vitest';

import type { AiBackendConfig } from './config';
import {
  generateMeetingSummary,
  renderMeetingSummaryMarkdown,
} from './meeting-summary.js';
import type { ModelSelection } from './providers';
import { generateBackendObject } from './text-runtime';

vi.mock('./text-runtime', () => ({ generateBackendObject: vi.fn() }));

describe('meeting summary Markdown', () => {
  test('bounds generated sections to prevent endless list generation', async () => {
    const summary = {
      title: 'Meeting',
      overview: 'A short overview.',
      keyTakeaways: [],
      decisions: [],
      actionItems: [],
      followUps: [],
      risksAndBlockers: [],
      openQuestions: [],
      topics: [],
    };
    const generate = vi.mocked(generateBackendObject);
    generate.mockResolvedValue({
      structured: summary,
      model: 'fixture',
      provider: 'local',
      runtime: 'local-onnx',
    });
    await generateMeetingSummary({
      config: {} as AiBackendConfig,
      selected: {} as ModelSelection,
      prompt: 'Discuss the release.',
    });
    const schema = generate.mock.calls[0][0].schema;
    expect(schema.safeParse(summary).success).toBe(true);
    expect(
      schema.safeParse({
        ...summary,
        keyTakeaways: Array.from({ length: 100 }, () => 'Repeated point'),
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({ ...summary, overview: 'Repeated point '.repeat(100) })
        .success
    ).toBe(false);
  });
  test('renders grounded decisions and actionable owner metadata', () => {
    const markdown = renderMeetingSummaryMarkdown({
      actionItems: [
        {
          dueDate: '2026-07-20',
          owner: 'Kunj',
          priority: 'high',
          text: 'Ship the desktop QA build',
        },
      ],
      decisions: ['Keep meeting capture local-first.'],
      followUps: ['Verify calendar permission after restart.'],
      keyTakeaways: ['The transcript recovery spool is durable.'],
      openQuestions: ['When will Developer ID be issued?'],
      overview: 'The team reviewed release readiness and recovery behavior.',
      risksAndBlockers: ['Developer ID signing is not available yet.'],
      title: 'Release readiness',
      topics: [
        {
          notes: ['Fallback audio remains available until verification.'],
          title: 'Meeting capture',
        },
      ],
    });

    expect(markdown).toContain('# Release readiness');
    expect(markdown).toContain('## Decisions');
    expect(markdown).toContain('- Keep meeting capture local-first.');
    expect(markdown).toContain(
      '- [ ] Ship the desktop QA build (Owner: Kunj, Due: 2026-07-20, Priority: high)'
    );
    expect(markdown).toContain('### Meeting capture');
  });

  test('does not invent content for empty sections', () => {
    const markdown = renderMeetingSummaryMarkdown({
      actionItems: [],
      decisions: [],
      followUps: [],
      keyTakeaways: [],
      openQuestions: [],
      overview: '',
      risksAndBlockers: [],
      title: '   ',
      topics: [],
    });

    expect(markdown).toContain('# Meeting Notes');
    expect(markdown).toContain('No transcript content was available.');
    expect(markdown.match(/- None recorded\./g)?.length).toBeGreaterThan(4);
  });
});
