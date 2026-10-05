import { describe, expect, test } from 'vitest';

import { renderMeetingSummaryMarkdown } from './meeting-summary.js';

describe('meeting summary Markdown', () => {
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
