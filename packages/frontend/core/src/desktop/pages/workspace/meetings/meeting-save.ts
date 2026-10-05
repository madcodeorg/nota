import { toBase64UrlEncoded } from 'lib0/buffer.js';
import { digest } from 'lib0/hash/sha256';

export type SavedMeetingTranscriptSegment = {
  endMs: number;
  id: string;
  source: 'mic' | 'system';
  startMs: number;
  text: string;
  type: 'final' | 'partial';
};

export type SavedMeeting = {
  createdAt: string;
  id: string;
  microphoneRecordingPath?: string | null;
  providerId?: string;
  recordingDurationMs?: number | null;
  recordingPath?: string | null;
  savedTranscriptSegmentSnapshots?: Record<string, string>;
  stt?: {
    message?: string | null;
    status?: string | null;
  };
  sttModelId?: string;
  updatedAt: string;
};

export class MeetingTranscriptPendingError extends Error {
  constructor() {
    super(
      'Meeting transcription is still finishing. The pending save will retry when the final transcript appears.'
    );
    this.name = 'MeetingTranscriptPendingError';
  }
}

export function isMeetingTranscriptionPending(status?: string | null) {
  return (
    status === 'starting' || status === 'running' || status === 'finalizing'
  );
}

export function resolveMeetingSaveDestination(input: {
  existingDocIsJournal: boolean;
  hasExistingDoc: boolean;
  preferred: 'journal-today' | 'new-doc';
}) {
  if (!input.hasExistingDoc) {
    return input.preferred;
  }
  return input.existingDocIsJournal ? 'journal-today' : 'new-doc';
}

export function meetingDurationSeconds(meeting: {
  recordingDurationMs?: number | null;
  transcriptSegments?: Pick<SavedMeetingTranscriptSegment, 'endMs'>[];
}) {
  const durationMs =
    meeting.recordingDurationMs ??
    Math.max(
      0,
      ...(meeting.transcriptSegments ?? []).map(segment => segment.endMs)
    );
  return Math.max(0, Math.round(durationMs / 1000));
}

export function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}`;
}

function transcriptLine(
  segment: SavedMeetingTranscriptSegment,
  providerId?: string
) {
  const speaker =
    providerId === 'apple-speechanalyzer'
      ? segment.source === 'mic'
        ? 'You'
        : 'Meeting'
      : 'Speaker';
  const start = formatElapsedTime(Math.floor(segment.startMs / 1000));
  const end = formatElapsedTime(Math.ceil(segment.endMs / 1000));
  return `[${start} - ${end}] ${speaker}: ${segment.text}`;
}

function transcriptMarkdown(
  segments: SavedMeetingTranscriptSegment[],
  providerId?: string
) {
  const lines = segments
    .filter(segment => segment.type === 'final' && segment.text.trim())
    .map(segment => transcriptLine(segment, providerId));
  return lines.length ? lines.join('\n') : '_No transcript captured._';
}

export function meetingTranscriptSegmentSnapshot(
  segment: SavedMeetingTranscriptSegment
) {
  return JSON.stringify([
    1,
    segment.text,
    segment.startMs,
    segment.endMs,
    segment.source,
  ]);
}

export function meetingTranscriptSaveDelta(input: {
  savedTranscriptSegmentIds?: string[];
  savedTranscriptSegmentSnapshots?: Record<string, string>;
  transcriptSaveInitialized?: boolean;
  transcriptSegments: SavedMeetingTranscriptSegment[];
}) {
  const finalTranscriptSegments = input.transcriptSegments
    .filter(segment => segment.type === 'final' && segment.text.trim())
    .map(segment => ({ ...segment }));
  const transcriptSegmentSnapshots = Object.fromEntries(
    finalTranscriptSegments.map(segment => [
      segment.id,
      meetingTranscriptSegmentSnapshot(segment),
    ])
  );
  // ID-only watermarks cannot prove which text reached the note. Recover each
  // legacy final once, then acknowledge its exact content instead of its ID.
  const missingTranscriptSegments = input.transcriptSaveInitialized
    ? finalTranscriptSegments.filter(
        segment =>
          input.savedTranscriptSegmentSnapshots?.[segment.id] !==
          transcriptSegmentSnapshots[segment.id]
      )
    : [];
  return {
    finalTranscriptSegments,
    missingTranscriptSegments,
    transcriptSegmentSnapshots,
    needsSave:
      !input.transcriptSaveInitialized || missingTranscriptSegments.length > 0,
  };
}

export function meetingTranscriptRecoverySegments(input: {
  durableBackendLink: boolean;
  finalTranscriptSegments: SavedMeetingTranscriptSegment[];
  missingTranscriptSegments: SavedMeetingTranscriptSegment[];
  transcriptBlockExists: boolean;
  transcriptSaveInitialized?: boolean;
}) {
  // A pre-existing block may be a legacy partial import or user-edited content.
  // Preserve every final before acknowledging it, without rewriting that block.
  // A fresh import in this attempt has neither an old block nor a durable link.
  if (
    !input.transcriptSaveInitialized &&
    (input.durableBackendLink || input.transcriptBlockExists)
  ) {
    return input.finalTranscriptSegments;
  }
  return input.missingTranscriptSegments;
}

export function meetingNoteMarkdown(input: {
  headingLevel?: 1 | 2;
  includeTitle?: boolean;
  meeting: SavedMeeting;
  microphoneRecordingPath?: string | null;
  recordingPath?: string | null;
  summary?: string | null;
  title: string;
  transcriptSegments: SavedMeetingTranscriptSegment[];
}) {
  const headingLevel = input.headingLevel ?? 1;
  const titleHeading = '#'.repeat(headingLevel);
  const sectionHeading = '#'.repeat(headingLevel + 1);
  const recordingPath =
    input.recordingPath || input.meeting.recordingPath || '';
  const microphoneRecordingPath =
    input.microphoneRecordingPath ||
    input.meeting.microphoneRecordingPath ||
    '';
  const summary = input.summary?.trim();
  const transcriptWarning =
    input.meeting.stt?.status === 'error' ||
    input.meeting.stt?.status === 'unavailable'
      ? input.meeting.stt.message?.trim() ||
        'Transcription did not finish successfully; the available transcript may be incomplete.'
      : null;
  return [
    ...(input.includeTitle === false
      ? []
      : [`${titleHeading} ${input.title}`, '']),
    ...(transcriptWarning
      ? [`> Transcript warning: ${transcriptWarning}`, '']
      : []),
    ...(summary ? [`${sectionHeading} Summary`, '', summary, ''] : []),
    `${sectionHeading} Transcript`,
    '',
    transcriptMarkdown(input.transcriptSegments, input.meeting.providerId),
    '',
    `${sectionHeading} Audio Recording`,
    '',
    recordingPath
      ? '- System audio: Captured and retained locally by Nota.'
      : '- System audio was not captured for this meeting.',
    microphoneRecordingPath
      ? '- Microphone audio: Captured and retained locally by Nota.'
      : '- Microphone audio was not captured for this meeting.',
    input.meeting.recordingDurationMs
      ? `- Duration: ${formatElapsedTime(
          Math.round(input.meeting.recordingDurationMs / 1000)
        )}`
      : null,
    '',
    `${sectionHeading} Meeting Details`,
    '',
    `- Meeting ID: ${input.meeting.id}`,
    `- Started: ${input.meeting.createdAt}`,
    `- Stopped: ${input.meeting.updatedAt}`,
    `- STT provider: ${input.meeting.providerId ?? 'unknown'}`,
    `- STT model: ${input.meeting.sttModelId || 'unknown'}`,
  ]
    .filter(line => line !== null)
    .join('\n');
}

export function meetingSummarySectionMarkdown(input: {
  headingLevel?: 2 | 3;
  summary: string;
}) {
  const heading = '#'.repeat(input.headingLevel ?? 2);
  return `${heading} AI Summary\n\n${input.summary.trim()}`;
}

export function meetingTranscriptRecoveryMarkdown(input: {
  headingLevel?: 2 | 3;
  providerId?: string;
  transcriptSegments: SavedMeetingTranscriptSegment[];
}) {
  const heading = '#'.repeat(input.headingLevel ?? 2);
  return [
    `${heading} Recovered Transcript`,
    '',
    '> Nota recovered these missing or updated segments after the meeting note was first saved. The original transcript is preserved.',
    '',
    transcriptMarkdown(input.transcriptSegments, input.providerId),
  ].join('\n');
}

export function meetingDocumentId(meetingId: string) {
  return `nota-meeting-${meetingId}`;
}

export function meetingContentBlockId(
  meetingId: string,
  kind:
    | 'microphone-recording'
    | 'recording'
    | 'recordings'
    | 'summary'
    | 'transcript'
) {
  return `nota-meeting-${meetingId}-${kind}`;
}

export function resolveMeetingRecordingParentBlockId(input: {
  blockExists: (blockId: string) => boolean;
  meetingId: string;
}) {
  const transcriptBlockId = meetingContentBlockId(
    input.meetingId,
    'transcript'
  );
  return input.blockExists(transcriptBlockId)
    ? transcriptBlockId
    : meetingContentBlockId(input.meetingId, 'recordings');
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function meetingTranscriptRecoveryBlockId(
  meetingId: string,
  segments: string[] | SavedMeetingTranscriptSegment[]
) {
  const prefix = `nota-meeting-${meetingId}-transcript-recovery`;
  if (segments.every(segment => typeof segment === 'string')) {
    return `${prefix}-${stableTextHash(segments.join('|'))}`;
  }
  const content = JSON.stringify(
    (segments as SavedMeetingTranscriptSegment[]).map(segment => [
      segment.id,
      meetingTranscriptSegmentSnapshot(segment),
    ])
  );
  // A matching block suppresses recovery, so content identities need a full
  // collision-resistant digest and must not reuse legacy 32-bit block IDs.
  return `${prefix}-v2-${toBase64UrlEncoded(
    digest(new TextEncoder().encode(content))
  )}`;
}

export function findReusableMeetingDocId(input: {
  backendDocId?: string | null;
  docExists: (docId: string) => boolean;
  localDocId?: string | null;
  localDocIds?: ReadonlyArray<string | null | undefined>;
}) {
  const seen = new Set<string>();
  for (const candidate of [
    input.backendDocId,
    input.localDocId,
    ...(input.localDocIds ?? []),
  ]) {
    const docId = candidate?.trim();
    if (!docId || seen.has(docId)) {
      continue;
    }
    seen.add(docId);
    if (input.docExists(docId)) {
      return docId;
    }
  }
  return null;
}
