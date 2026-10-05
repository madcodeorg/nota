import { z } from 'zod';

import type { AiBackendConfig } from './config';
import type { ModelSelection } from './providers';
import { generateBackendObject } from './text-runtime';

const MeetingSummarySchema = z.object({
  title: z.string().describe('Short meeting title.'),
  overview: z
    .string()
    .describe('Two to four sentence executive meeting overview.'),
  keyTakeaways: z
    .array(z.string())
    .describe('Important takeaways a reader should remember.'),
  decisions: z
    .array(z.string())
    .describe('Concrete decisions made during the meeting.'),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe('Action item phrased as a task.'),
        owner: z
          .string()
          .nullable()
          .describe('Owner if explicitly known, otherwise null.'),
        dueDate: z
          .string()
          .nullable()
          .describe('Due date if explicitly known, otherwise null.'),
        priority: z
          .enum(['high', 'medium', 'low'])
          .nullable()
          .describe('Priority if inferable from urgency, otherwise null.'),
      })
    )
    .describe('Action items extracted from the meeting.'),
  followUps: z
    .array(z.string())
    .describe(
      'Follow-up topics or async checks that are not task assignments.'
    ),
  risksAndBlockers: z
    .array(z.string())
    .describe('Risks, blockers, dependencies, or caveats raised.'),
  openQuestions: z.array(z.string()).describe('Unresolved questions.'),
  topics: z
    .array(
      z.object({
        title: z.string(),
        notes: z.array(z.string()),
      })
    )
    .describe('Topic-by-topic notes for skimming.'),
});

export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

const MEETING_SUMMARY_SYSTEM = [
  'You summarize Nota meeting and workspace material.',
  'Create Notion-quality meeting notes that are concise, useful, and scannable.',
  'Extract only what is grounded in the transcript, notes, and meeting metadata.',
  'If source material is missing, say so directly in the summary.',
  'Do not invent decisions, owners, dates, or action items.',
  'Prefer short bullets over paragraphs except for the overview.',
].join(' ');

function bulletList(items: string[], empty = '- None recorded.') {
  return items.length ? items.map(item => `- ${item}`) : [empty];
}

function cleanText(value: string) {
  return value.trim();
}

function cleanTextList(items: string[]) {
  return items.map(cleanText).filter(Boolean);
}

function normalizeMeetingSummary(summary: MeetingSummary): MeetingSummary {
  return {
    ...summary,
    actionItems: summary.actionItems
      .map(item => ({
        ...item,
        dueDate: item.dueDate?.trim() || null,
        owner: item.owner?.trim() || null,
        text: item.text.trim(),
      }))
      .filter(item => item.text.length > 0),
    decisions: cleanTextList(summary.decisions),
    followUps: cleanTextList(summary.followUps),
    keyTakeaways: cleanTextList(summary.keyTakeaways),
    openQuestions: cleanTextList(summary.openQuestions),
    overview: summary.overview.trim(),
    risksAndBlockers: cleanTextList(summary.risksAndBlockers),
    title: summary.title.trim() || 'Meeting Notes',
    topics: summary.topics
      .map(topic => ({
        notes: cleanTextList(topic.notes),
        title: topic.title.trim(),
      }))
      .filter(topic => topic.title.length > 0 || topic.notes.length > 0)
      .map(topic => ({
        ...topic,
        title: topic.title || 'Notes',
      })),
  };
}

export function renderMeetingSummaryMarkdown(summary: MeetingSummary) {
  const cleanSummary = normalizeMeetingSummary(summary);
  const actionItems = cleanSummary.actionItems.length
    ? cleanSummary.actionItems.map(item => {
        const details = [
          item.owner ? `Owner: ${item.owner}` : '',
          item.dueDate ? `Due: ${item.dueDate}` : '',
          item.priority ? `Priority: ${item.priority}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return `- [ ] ${item.text}${details ? ` (${details})` : ''}`;
      })
    : ['- None recorded.'];
  const topics = cleanSummary.topics.length
    ? cleanSummary.topics.flatMap(topic => [
        `### ${topic.title}`,
        ...bulletList(topic.notes),
        '',
      ])
    : ['- None recorded.', ''];

  return [
    `# ${cleanSummary.title}`,
    '',
    '## TL;DR',
    cleanSummary.overview || 'No transcript content was available.',
    '',
    '## Key Takeaways',
    ...bulletList(cleanSummary.keyTakeaways),
    '',
    '## Decisions',
    ...bulletList(cleanSummary.decisions),
    '',
    '## Action Items',
    ...actionItems,
    '',
    '## Follow-ups',
    ...bulletList(cleanSummary.followUps),
    '',
    '## Risks / Blockers',
    ...bulletList(cleanSummary.risksAndBlockers),
    '',
    '## Open Questions',
    ...bulletList(cleanSummary.openQuestions),
    '',
    '## Topic Notes',
    ...topics,
  ].join('\n');
}

export async function generateMeetingSummary(input: {
  config: AiBackendConfig;
  prompt: string;
  selected: ModelSelection;
}) {
  const result = await generateBackendObject({
    config: input.config,
    description: 'Structured meeting notes for a local-first Nota workspace.',
    maxOutputTokens: 12_000,
    name: 'meeting_summary',
    prompt: input.prompt,
    schema: MeetingSummarySchema,
    selected: input.selected,
    system: MEETING_SUMMARY_SYSTEM,
  });
  const structured = normalizeMeetingSummary(result.structured);
  return {
    model: result.model,
    provider: result.provider,
    runtime: result.runtime,
    structured,
    text: renderMeetingSummaryMarkdown(structured),
  };
}
