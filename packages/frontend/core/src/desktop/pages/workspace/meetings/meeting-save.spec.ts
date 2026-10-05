import { describe, expect, test, vi } from 'vitest';

import {
  findReusableMeetingDocId,
  meetingContentBlockId,
  meetingDocumentId,
  meetingNoteMarkdown,
  meetingSummarySectionMarkdown,
  meetingTranscriptRecoveryBlockId,
  meetingTranscriptRecoveryMarkdown,
  meetingTranscriptRecoverySegments,
  meetingTranscriptSaveDelta,
  meetingTranscriptSegmentSnapshot,
  resolveMeetingRecordingParentBlockId,
  resolveMeetingSaveDestination,
} from './meeting-save';

const meeting = {
  createdAt: '2026-07-16T13:00:00.000Z',
  id: 'meeting-1',
  providerId: 'nemotron-onnx',
  recordingDurationMs: 65_000,
  recordingPath: '/tmp/meeting.raw',
  sttModelId: 'nemotron-3.5-asr-streaming-int4',
  updatedAt: '2026-07-16T13:01:05.000Z',
};

describe('meetingNoteMarkdown', () => {
  test('saves transcript and metadata without requiring an AI summary', () => {
    const markdown = meetingNoteMarkdown({
      meeting,
      title: 'Meeting Jul 16, 9:00 AM',
      transcriptSegments: [
        {
          endMs: 1500,
          id: 'final-1',
          source: 'mic',
          startMs: 0,
          text: 'Local transcript survives without AI.',
          type: 'final',
        },
        {
          endMs: 2000,
          id: 'partial-1',
          source: 'system',
          startMs: 1500,
          text: 'Partial text is not canonical.',
          type: 'partial',
        },
      ],
    });

    expect(markdown).not.toContain('## Summary');
    expect(markdown).toContain(
      '[00:00 - 00:02] Speaker: Local transcript survives without AI.'
    );
    expect(markdown).not.toContain('Partial text is not canonical.');
    expect(markdown).toContain('- Duration: 01:05');
    expect(markdown).toContain('- Meeting ID: meeting-1');
    expect(markdown).toContain('- STT provider: nemotron-onnx');
  });

  test('lists microphone and system recordings as separate sources', () => {
    const markdown = meetingNoteMarkdown({
      meeting: {
        ...meeting,
        microphoneRecordingPath: '/tmp/meeting-microphone.opus',
        recordingPath: '/tmp/meeting-system.opus',
      },
      title: 'Meeting Jul 16, 9:00 AM',
      transcriptSegments: [],
    });

    expect(markdown).toContain(
      '- System audio: Captured and retained locally by Nota.'
    );
    expect(markdown).toContain(
      '- Microphone audio: Captured and retained locally by Nota.'
    );
    expect(markdown).not.toContain('/tmp/');
    expect(markdown).not.toContain('/Users/');
  });

  test('includes an already-generated summary as optional content', () => {
    const markdown = meetingNoteMarkdown({
      headingLevel: 2,
      meeting,
      summary: 'Existing local summary.',
      title: 'Meeting Jul 16, 9:00 AM',
      transcriptSegments: [],
    });

    expect(markdown).toContain('## Meeting Jul 16, 9:00 AM');
    expect(markdown).toContain('### Summary\n\nExisting local summary.');
    expect(markdown).toContain('### Transcript\n\n_No transcript captured._');
  });

  test('can omit a duplicate body title when the document already owns it', () => {
    const markdown = meetingNoteMarkdown({
      includeTitle: false,
      meeting,
      title: 'Meeting Jul 16, 9:00 AM',
      transcriptSegments: [],
    });

    expect(markdown).not.toContain('# Meeting Jul 16, 9:00 AM');
    expect(markdown).toContain('## Transcript');
  });

  test('labels a preserved partial transcript when finalization failed', () => {
    const markdown = meetingNoteMarkdown({
      meeting: {
        ...meeting,
        stt: { message: 'Decoder failed.', status: 'error' },
      },
      title: 'Meeting Jul 16, 9:00 AM',
      transcriptSegments: [],
    });

    expect(markdown).toContain('> Transcript warning: Decoder failed.');
  });
});

describe('findReusableMeetingDocId', () => {
  test('reuses the durable backend link instead of creating another document', () => {
    const docExists = vi.fn((docId: string) => docId === 'saved-doc');

    expect(
      findReusableMeetingDocId({
        backendDocId: 'saved-doc',
        docExists,
        localDocId: 'pending-doc',
      })
    ).toBe('saved-doc');
    expect(docExists).toHaveBeenCalledOnce();
  });

  test('reuses a locally-created document while its backend patch is retried', () => {
    expect(
      findReusableMeetingDocId({
        backendDocId: 'deleted-doc',
        docExists: docId => docId === 'pending-doc',
        localDocId: 'pending-doc',
      })
    ).toBe('pending-doc');
  });

  test('falls through stale local candidates to a durable pending target', () => {
    expect(
      findReusableMeetingDocId({
        backendDocId: 'deleted-doc',
        docExists: docId => docId === 'pending-doc',
        localDocId: 'also-deleted-doc',
        localDocIds: ['pending-doc'],
      })
    ).toBe('pending-doc');
  });
});

describe('meeting save destination', () => {
  test('uses the actual type of an existing target after preferences change', () => {
    expect(
      resolveMeetingSaveDestination({
        existingDocIsJournal: false,
        hasExistingDoc: true,
        preferred: 'journal-today',
      })
    ).toBe('new-doc');
    expect(
      resolveMeetingSaveDestination({
        existingDocIsJournal: true,
        hasExistingDoc: true,
        preferred: 'new-doc',
      })
    ).toBe('journal-today');
  });
});

describe('deterministic meeting content ids', () => {
  test('preserves legacy string-only recovery IDs', () => {
    expect(
      meetingTranscriptRecoveryBlockId('meeting-1', ['legacy-1', 'late-2'])
    ).toBe('nota-meeting-meeting-1-transcript-recovery-1s5b4fj');
  });

  test('distinguishes transcript records that collided under the legacy 32-bit hash', () => {
    const segments = [2928, 11223].map(index => ({
      endMs: 1_000,
      id: `segment-${index}`,
      source: 'mic' as const,
      startMs: 0,
      text: `Transcript record ${index}.`,
      type: 'final' as const,
    }));
    // Both serialized records formerly produced the recovery suffix "opej7b".
    // These full SHA-256 vectors were independently computed with node:crypto.
    const expected = [
      '44iBWK-EyMb1NA9FQT06iEbpwmdK0zkgv6afVb9-STA',
      '9U--19eTq8bShvdn6DWgQL2miyICLFYovxbU8yRy0V4',
    ];
    const ids = segments.map(segment =>
      meetingTranscriptRecoveryBlockId('meeting-1', [segment])
    );
    expect(ids).toEqual(
      expected.map(
        hash => `nota-meeting-meeting-1-transcript-recovery-v2-${hash}`
      )
    );
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toBe(
      meetingTranscriptRecoveryBlockId('meeting-1', [{ ...segments[0] }])
    );
  });

  test('keeps retries on the same document and blocks', () => {
    expect(meetingDocumentId('meeting-1')).toBe('nota-meeting-meeting-1');
    expect(meetingContentBlockId('meeting-1', 'transcript')).toBe(
      'nota-meeting-meeting-1-transcript'
    );
    expect(meetingContentBlockId('meeting-1', 'recording')).toBe(
      'nota-meeting-meeting-1-recording'
    );
    expect(meetingContentBlockId('meeting-1', 'microphone-recording')).toBe(
      'nota-meeting-meeting-1-microphone-recording'
    );
    expect(meetingContentBlockId('meeting-1', 'summary')).toBe(
      'nota-meeting-meeting-1-summary'
    );
  });

  test('keeps journal audio under its meeting note when unrelated notes were added later', () => {
    const transcriptBlockId = meetingContentBlockId('meeting-1', 'transcript');
    const laterUnrelatedNoteId = 'journal-note-added-later';
    const journalBlocks = new Set([transcriptBlockId, laterUnrelatedNoteId]);

    const parentBlockId = resolveMeetingRecordingParentBlockId({
      blockExists: blockId => journalBlocks.has(blockId),
      meetingId: 'meeting-1',
    });

    expect(parentBlockId).toBe(transcriptBlockId);
    expect(parentBlockId).not.toBe(laterUnrelatedNoteId);
  });
});

describe('late transcript recovery', () => {
  test('appends only missing final segments to an already-linked note', () => {
    const transcriptSegments = [
      {
        endMs: 500,
        id: 'live-1',
        source: 'mic' as const,
        startMs: 0,
        text: 'Saved live transcript.',
        type: 'final' as const,
      },
      {
        endMs: 1_200,
        id: 'recovered-2',
        source: 'system' as const,
        startMs: 500,
        text: 'Recovered after model download.',
        type: 'final' as const,
      },
      {
        endMs: 1_500,
        id: 'partial-3',
        source: 'mic' as const,
        startMs: 1_200,
        text: 'Still partial.',
        type: 'partial' as const,
      },
    ];
    const delta = meetingTranscriptSaveDelta({
      savedTranscriptSegmentIds: ['live-1'],
      savedTranscriptSegmentSnapshots: {
        'live-1': meetingTranscriptSegmentSnapshot(transcriptSegments[0]),
      },
      transcriptSaveInitialized: true,
      transcriptSegments,
    });

    expect(delta.needsSave).toBe(true);
    expect(delta.missingTranscriptSegments.map(segment => segment.id)).toEqual([
      'recovered-2',
    ]);
    expect(delta.finalTranscriptSegments.map(segment => segment.id)).toEqual([
      'live-1',
      'recovered-2',
    ]);
    const recoverySegments = meetingTranscriptRecoverySegments({
      durableBackendLink: true,
      finalTranscriptSegments: delta.finalTranscriptSegments,
      missingTranscriptSegments: delta.missingTranscriptSegments,
      transcriptBlockExists: true,
      transcriptSaveInitialized: true,
    });

    const recoveryBlockId = meetingTranscriptRecoveryBlockId(
      meeting.id,
      recoverySegments.map(segment => segment.id)
    );
    expect(recoveryBlockId).toBe(
      meetingTranscriptRecoveryBlockId(meeting.id, ['recovered-2'])
    );
    const markdown = meetingTranscriptRecoveryMarkdown({
      providerId: meeting.providerId,
      transcriptSegments: recoverySegments,
    });
    expect(markdown).toContain('Speaker: Recovered after model download.');
    expect(markdown).not.toContain('Saved live transcript.');
    expect(markdown).not.toContain('Still partial.');
  });

  test('materializes every final segment for an uninitialized legacy link without a transcript block', () => {
    const delta = meetingTranscriptSaveDelta({
      savedTranscriptSegmentIds: [],
      transcriptSaveInitialized: false,
      transcriptSegments: [
        {
          endMs: 500,
          id: 'legacy-1',
          source: 'mic',
          startMs: 0,
          text: 'Legacy transcript segment.',
          type: 'final',
        },
        {
          endMs: 1_000,
          id: 'late-2',
          source: 'system',
          startMs: 500,
          text: 'Late recovered segment.',
          type: 'final',
        },
        {
          endMs: 1_200,
          id: 'partial-3',
          source: 'mic',
          startMs: 1_000,
          text: 'Uncommitted partial.',
          type: 'partial',
        },
      ],
    });
    expect(delta.missingTranscriptSegments).toEqual([]);

    const recoverySegments = meetingTranscriptRecoverySegments({
      durableBackendLink: true,
      finalTranscriptSegments: delta.finalTranscriptSegments,
      missingTranscriptSegments: delta.missingTranscriptSegments,
      transcriptBlockExists: false,
      transcriptSaveInitialized: false,
    });
    expect(recoverySegments.map(segment => segment.id)).toEqual([
      'legacy-1',
      'late-2',
    ]);
    const blockId = meetingTranscriptRecoveryBlockId(
      meeting.id,
      recoverySegments.map(segment => segment.id)
    );
    expect(blockId).toBe(
      meetingTranscriptRecoveryBlockId(meeting.id, ['legacy-1', 'late-2'])
    );
    const markdown = meetingTranscriptRecoveryMarkdown({
      providerId: meeting.providerId,
      transcriptSegments: recoverySegments,
    });
    expect(markdown).toContain('Legacy transcript segment.');
    expect(markdown).toContain('Late recovered segment.');
    expect(markdown).not.toContain('Uncommitted partial.');
  });

  test('recovers an unacknowledged existing block but does not duplicate a fresh import', () => {
    const finalTranscriptSegments = [
      {
        endMs: 500,
        id: 'final-1',
        source: 'mic' as const,
        startMs: 0,
        text: 'Canonical transcript.',
        type: 'final' as const,
      },
    ];

    expect(
      meetingTranscriptRecoverySegments({
        durableBackendLink: false,
        finalTranscriptSegments,
        missingTranscriptSegments: [],
        transcriptBlockExists: false,
        transcriptSaveInitialized: false,
      })
    ).toEqual([]);
    expect(
      meetingTranscriptRecoverySegments({
        durableBackendLink: true,
        finalTranscriptSegments,
        missingTranscriptSegments: [],
        transcriptBlockExists: true,
        transcriptSaveInitialized: false,
      })
    ).toEqual(finalTranscriptSegments);
    expect(
      meetingTranscriptRecoverySegments({
        durableBackendLink: false,
        finalTranscriptSegments,
        missingTranscriptSegments: [],
        transcriptBlockExists: true,
        transcriptSaveInitialized: false,
      })
    ).toEqual(finalTranscriptSegments);
  });

  test('recovers ID-only legacy finals once before acknowledging their content', () => {
    const transcriptSegments = [
      {
        endMs: 500,
        id: 'legacy-1',
        source: 'mic' as const,
        startMs: 0,
        text: 'Potentially revised legacy transcript.',
        type: 'final' as const,
      },
    ];
    const migrated = meetingTranscriptSaveDelta({
      savedTranscriptSegmentIds: ['legacy-1'],
      transcriptSaveInitialized: true,
      transcriptSegments,
    });
    expect(migrated.needsSave).toBe(true);
    expect(migrated.missingTranscriptSegments).toEqual(transcriptSegments);
    expect(
      meetingTranscriptSaveDelta({
        savedTranscriptSegmentIds: ['legacy-1'],
        savedTranscriptSegmentSnapshots: migrated.transcriptSegmentSnapshots,
        transcriptSaveInitialized: true,
        transcriptSegments,
      }).needsSave
    ).toBe(false);
  });

  test.each([
    { text: 'Corrected same-ID transcript.' },
    { endMs: 1_500 },
    { startMs: 100 },
    { source: 'system' as const },
  ])(
    'recovers same-ID updates with a content-keyed retry block: %j',
    update => {
      const original = {
        endMs: 500,
        id: 'final-1',
        source: 'mic' as const,
        startMs: 0,
        text: 'Original transcript.',
        type: 'final' as const,
      };
      const changed = { ...original, ...update };
      const previous = meetingTranscriptSaveDelta({
        transcriptSegments: [original],
      });
      const delta = meetingTranscriptSaveDelta({
        savedTranscriptSegmentIds: ['final-1'],
        savedTranscriptSegmentSnapshots: previous.transcriptSegmentSnapshots,
        transcriptSaveInitialized: true,
        transcriptSegments: [changed],
      });
      expect(delta.needsSave).toBe(true);
      expect(delta.missingTranscriptSegments).toEqual([changed]);
      const blockId = meetingTranscriptRecoveryBlockId(meeting.id, [changed]);
      expect(blockId).toBe(
        meetingTranscriptRecoveryBlockId(meeting.id, [{ ...changed }])
      );
      expect(blockId).not.toBe(
        meetingTranscriptRecoveryBlockId(meeting.id, [original])
      );
      expect(
        meetingTranscriptSaveDelta({
          savedTranscriptSegmentSnapshots: delta.transcriptSegmentSnapshots,
          transcriptSaveInitialized: true,
          transcriptSegments: [changed],
        }).needsSave
      ).toBe(false);
      expect(original.text).toBe('Original transcript.');
    }
  );

  test('captures detached content before a live same-ID update mutates the input', () => {
    const segment = {
      endMs: 500,
      id: 'final-1',
      source: 'mic' as const,
      startMs: 0,
      text: 'Fetched transcript.',
      type: 'final' as const,
    };
    const delta = meetingTranscriptSaveDelta({
      transcriptSegments: [segment],
    });
    segment.text = 'Changed while the note was saving.';
    expect(delta.finalTranscriptSegments[0].text).toBe('Fetched transcript.');
    expect(delta.transcriptSegmentSnapshots).toEqual({
      'final-1': '[1,"Fetched transcript.",0,500,"mic"]',
    });
    expect(
      meetingTranscriptSaveDelta({
        savedTranscriptSegmentSnapshots: delta.transcriptSegmentSnapshots,
        transcriptSaveInitialized: true,
        transcriptSegments: [segment],
      }).needsSave
    ).toBe(true);
  });

  test('recovers malformed and unknown-version opaque snapshots conservatively', () => {
    const segment = {
      endMs: 1_000,
      id: 'same-id',
      source: 'mic' as const,
      startMs: 0,
      text: 'Original transcript.',
      type: 'final' as const,
    };
    for (const snapshot of [
      'not-json',
      'null',
      '{}',
      '[1]',
      '[2,"Original transcript.",0,1000,"mic"]',
      '[1,"Older transcript.",0,1000,"mic"]',
    ]) {
      const delta = meetingTranscriptSaveDelta({
        savedTranscriptSegmentIds: ['same-id'],
        savedTranscriptSegmentSnapshots: { 'same-id': snapshot },
        transcriptSaveInitialized: true,
        transcriptSegments: [segment],
      });
      expect(delta.needsSave).toBe(true);
      expect(delta.missingTranscriptSegments).toEqual([segment]);
    }
  });

  test('uses own snapshot values for prototype-named segment IDs', () => {
    const segments = ['__proto__', 'constructor', 'toString'].map(id => ({
      endMs: 1_000,
      id,
      source: 'mic' as const,
      startMs: 0,
      text: 'Final transcript.',
      type: 'final' as const,
    }));
    const missing = meetingTranscriptSaveDelta({
      savedTranscriptSegmentSnapshots: {},
      transcriptSaveInitialized: true,
      transcriptSegments: segments,
    });
    expect(missing.missingTranscriptSegments).toEqual(segments);
    for (const { id } of segments) {
      expect(Object.hasOwn(missing.transcriptSegmentSnapshots, id)).toBe(true);
    }
    expect(
      meetingTranscriptSaveDelta({
        savedTranscriptSegmentSnapshots: JSON.parse(
          JSON.stringify(missing.transcriptSegmentSnapshots)
        ),
        transcriptSaveInitialized: true,
        transcriptSegments: segments,
      }).needsSave
    ).toBe(false);
  });

  test('ignores partial and empty finals when checking content acknowledgements', () => {
    const segment = {
      endMs: 500,
      id: 'final-1',
      source: 'mic' as const,
      startMs: 0,
      text: 'Final transcript.',
      type: 'final' as const,
    };
    const delta = meetingTranscriptSaveDelta({
      savedTranscriptSegmentSnapshots: {
        'final-1': meetingTranscriptSegmentSnapshot(segment),
      },
      transcriptSaveInitialized: true,
      transcriptSegments: [
        segment,
        { ...segment, id: 'partial-1', type: 'partial' },
        { ...segment, id: 'empty-1', text: '  ' },
      ],
    });
    expect(delta.needsSave).toBe(false);
    expect(Object.keys(delta.transcriptSegmentSnapshots)).toEqual(['final-1']);
    expect(
      meetingTranscriptSaveDelta({
        savedTranscriptSegmentIds: [],
        transcriptSaveInitialized: true,
        transcriptSegments: [],
      }).needsSave
    ).toBe(false);
  });
});

describe('meetingSummarySectionMarkdown', () => {
  test('appends a summary to an existing meeting note without duplicating the transcript', () => {
    expect(
      meetingSummarySectionMarkdown({
        headingLevel: 3,
        summary: '  Decisions and action items.  ',
      })
    ).toBe('### AI Summary\n\nDecisions and action items.');
  });
});
