/**
 * @vitest-environment happy-dom
 */
import 'fake-indexeddb/auto';

import { Text } from '@blocksuite/affine/store';
import { MarkdownTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { DocFrontend } from '@nota/nbstore/frontend';
import { IndexedDBDocStorage } from '@nota/nbstore/idb';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyUpdate, Doc as YDoc } from 'yjs';

import { DocSyncImpl } from '../../../../../../../common/nbstore/src/sync/doc';
import * as workspaceIndex from '../ai-workspace-index';
import {
  meetingContentBlockId,
  meetingTranscriptRecoveryBlockId,
  meetingTranscriptSegmentSnapshot,
} from './meeting-save';
import { runMeetingSaveOnce } from './meeting-save-dedupe';
import {
  appendMeetingMarkdownDoc,
  executeMeetingSave,
  type ExecuteMeetingSaveOptions,
  finalizePortableMeetingMicRecording,
  type MeetingSaveMeeting,
  type MeetingSaveMicExportAccess,
} from './meeting-save-executor';

afterEach(() => {
  vi.restoreAllMocks();
});

function createMeetingWorkspace() {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id: 'workspace-1', rootDoc });
  workspace.meta.initialize();
  const doc = workspace.createDoc('meeting-note');
  doc.load();
  const store = doc.getStore();
  const pageId = store.addBlock('affine:page', { title: new Text('Meeting') });
  const existingNoteId = store.addBlock('affine:note', {}, pageId);
  const existingParagraphId = store.addBlock(
    'affine:paragraph',
    { text: new Text('User notes') },
    existingNoteId
  );
  store.resetHistory();
  return {
    workspace,
    store,
    pageId,
    existingParagraphId,
    dispose: () => {
      workspace.dispose();
      rootDoc.destroy();
    },
  };
}

describe('atomic meeting markdown import', () => {
  test('places a summary before its transcript without changing transcript or user notes', async () => {
    const fixture = createMeetingWorkspace();
    try {
      await appendMeetingMarkdownDoc({
        blockId: 'transcript',
        docId: fixture.store.id,
        markdown: 'Original transcript',
        workspace: fixture.workspace,
      });
      const transcriptChildren = fixture.store
        .getModelById('transcript')
        ?.children.map(block => [block.id, block.text?.toString()]);
      await appendMeetingMarkdownDoc({
        beforeBlockId: 'transcript',
        blockId: 'summary',
        docId: fixture.store.id,
        markdown: 'Executive summary',
        workspace: fixture.workspace,
      });
      const children = fixture.store.getModelById(fixture.pageId)?.children;
      expect(children?.slice(-2).map(block => block.id)).toEqual([
        'summary',
        'transcript',
      ]);
      expect(
        fixture.store
          .getModelById('transcript')
          ?.children.map(block => [block.id, block.text?.toString()])
      ).toEqual(transcriptChildren);
      expect(
        fixture.store
          .getModelById(fixture.existingParagraphId)
          ?.text?.toString()
      ).toBe('User notes');
    } finally {
      fixture.dispose();
    }
  });

  test('moves an existing summary above the transcript on retry and preserves edited content', async () => {
    const fixture = createMeetingWorkspace();
    const options = {
      blockId: 'summary',
      docId: fixture.store.id,
      markdown: 'Original summary',
      workspace: fixture.workspace,
    };
    try {
      await appendMeetingMarkdownDoc({ ...options, blockId: 'transcript' });
      await appendMeetingMarkdownDoc(options);
      const summary = fixture.store.getModelById('summary');
      summary?.children
        .find(block => block.text?.toString() === 'Original summary')
        ?.text?.insert(' edited', 'Original summary'.length);
      const summaryChildren = summary?.children.map(block => [
        block.id,
        block.text?.toString(),
      ]);
      await appendMeetingMarkdownDoc({
        ...options,
        beforeBlockId: 'transcript',
      });
      expect(
        fixture.store
          .getModelById(fixture.pageId)
          ?.children.slice(-2)
          .map(block => block.id)
      ).toEqual(['summary', 'transcript']);
      expect(
        summary?.children.map(block => [block.id, block.text?.toString()])
      ).toEqual(summaryChildren);

      const updates = vi.fn();
      fixture.store.spaceDoc.on('update', updates);
      await appendMeetingMarkdownDoc({
        ...options,
        beforeBlockId: 'transcript',
      });
      expect(updates).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  test('publishes no partial block while importing, then commits one complete update', async () => {
    const fixture = createMeetingWorkspace();
    const original = MarkdownTransformer.importMarkdownToBlock;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    vi.spyOn(MarkdownTransformer, 'importMarkdownToBlock').mockImplementation(
      async options => {
        options.doc.addBlock(
          'affine:paragraph',
          { text: new Text('First imported paragraph') },
          options.blockId
        );
        await gate;
        await original(options);
      }
    );
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    try {
      const save = appendMeetingMarkdownDoc({
        blockId: 'transcript',
        docId: fixture.store.id,
        markdown: '- Final paragraph\n  - Nested item',
        workspace: fixture.workspace,
      });
      expect(Boolean(fixture.store.getBlock('transcript'))).toBe(false);
      expect(updates).not.toHaveBeenCalled();

      release();
      await save;
      expect(updates).toHaveBeenCalledOnce();
      const transcript = fixture.store.getModelById('transcript')!;
      expect(
        transcript.children.map(block => block.text?.toString())
      ).toContain('Final paragraph');
      const list = transcript.children.find(
        block => block.text?.toString() === 'Final paragraph'
      );
      expect(list?.children[0].text?.toString()).toBe('Nested item');

      const beforeRetry = updates.mock.calls.length;
      await appendMeetingMarkdownDoc({
        blockId: 'transcript',
        docId: fixture.store.id,
        markdown: 'Must not replace user content',
        workspace: fixture.workspace,
      });
      expect(updates).toHaveBeenCalledTimes(beforeRetry);
    } finally {
      release();
      fixture.dispose();
    }
  });

  test('discards a failed partial import and allows a complete retry', async () => {
    const fixture = createMeetingWorkspace();
    const importer = vi
      .spyOn(MarkdownTransformer, 'importMarkdownToBlock')
      .mockImplementationOnce(async options => {
        options.doc.addBlock(
          'affine:paragraph',
          { text: new Text('Incomplete') },
          options.blockId
        );
        throw new Error('Interrupted import');
      });
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    const options = {
      blockId: 'transcript',
      docId: fixture.store.id,
      markdown: 'Complete transcript',
      workspace: fixture.workspace,
    };
    try {
      await expect(appendMeetingMarkdownDoc(options)).rejects.toThrow(
        'Interrupted import'
      );
      expect(updates).not.toHaveBeenCalled();
      expect(Boolean(fixture.store.getBlock('transcript'))).toBe(false);
      importer.mockRestore();
      await appendMeetingMarkdownDoc(options);
      expect(updates).toHaveBeenCalledOnce();
      expect(
        fixture.store
          .getModelById('transcript')!
          .children.map(block => block.text?.toString())
      ).toContain('Complete transcript');
    } finally {
      fixture.dispose();
    }
  });

  test('preserves edits made to the live document while preparation is pending', async () => {
    const fixture = createMeetingWorkspace();
    const original = MarkdownTransformer.importMarkdownToBlock;
    vi.spyOn(MarkdownTransformer, 'importMarkdownToBlock').mockImplementation(
      async options => {
        fixture.store
          .getModelById(fixture.existingParagraphId)!
          .text!.insert(' updated', 10);
        await original(options);
      }
    );
    try {
      await appendMeetingMarkdownDoc({
        blockId: 'transcript',
        docId: fixture.store.id,
        markdown: 'Meeting transcript',
        workspace: fixture.workspace,
      });
      expect(
        fixture.store
          .getModelById(fixture.existingParagraphId)
          ?.text?.toString()
      ).toBe('User notes updated');
      expect(Boolean(fixture.store.getBlock('transcript'))).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test('rejects an importer failure that the block transformer reports as undefined', async () => {
    const fixture = createMeetingWorkspace();
    const original = MarkdownTransformer.importMarkdownToBlock;
    vi.spyOn(MarkdownTransformer, 'importMarkdownToBlock').mockImplementation(
      async options => {
        const transformer = options.doc.getTransformer();
        vi.spyOn(transformer, 'snapshotToBlock').mockResolvedValue(undefined);
        vi.spyOn(options.doc, 'getTransformer').mockReturnValue(transformer);
        await original(options);
      }
    );
    try {
      await expect(
        appendMeetingMarkdownDoc({
          blockId: 'transcript',
          docId: fixture.store.id,
          markdown: 'Meeting transcript',
          workspace: fixture.workspace,
        })
      ).rejects.toThrow('Failed to import markdown block');
      expect(Boolean(fixture.store.getBlock('transcript'))).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  test('does not duplicate a block committed by another save during preparation', async () => {
    const fixture = createMeetingWorkspace();
    const original = MarkdownTransformer.importMarkdownToBlock;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const importer = vi
      .spyOn(MarkdownTransformer, 'importMarkdownToBlock')
      .mockImplementationOnce(async options => {
        await gate;
        await original(options);
      });
    const options = {
      blockId: 'transcript',
      docId: fixture.store.id,
      markdown: 'Transcript',
      workspace: fixture.workspace,
    };
    const first = appendMeetingMarkdownDoc(options);
    try {
      await appendMeetingMarkdownDoc(options);
      release();
      await first;
      expect(
        fixture.store
          .getModelById(fixture.pageId)!
          .children.filter(block => block.id === 'transcript')
      ).toHaveLength(1);
      expect(importer).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await first.catch(() => {});
      fixture.dispose();
    }
  });
});

describe('meeting save execution', () => {
  function createSaveInput(fixture: ReturnType<typeof createMeetingWorkspace>) {
    const meeting = {
      createdAt: '2026-09-13T10:00:00Z',
      docId: fixture.store.id,
      id: 'meeting-1',
      status: 'stopped' as const,
      stt: { status: 'stopped' },
      updatedAt: '2026-09-13T11:00:00Z',
      workspaceId: 'workspace-1',
      transcriptSegments: [
        {
          id: 'segment-1',
          source: 'mic' as const,
          startMs: 0,
          endMs: 1000,
          text: 'Follow up tomorrow.',
          type: 'final' as const,
        },
      ],
    };
    const input: ExecuteMeetingSaveOptions = {
      accessForWorkspaceDocument: async () => true,
      assertCanCreateWorkspaceDocument: vi.fn(async () => {}),
      assertCanUpdateWorkspaceDocument: vi.fn(async () => {}),
      docPersistence: {
        waitForDocLoaded: vi.fn(async () => {}),
        waitForUpdated: vi.fn(async () => {}),
      },
      docsService: {
        createDoc: vi.fn(),
      } as unknown as ExecuteMeetingSaveOptions['docsService'],
      getMeeting: vi.fn(async () => meeting),
      journalService: {
        // Match the synchronous LiveData-facing service used by the executor.
        // eslint-disable-next-line rxjs/finnish
        journalDate$: () => ({ value: null }),
      } as unknown as ExecuteMeetingSaveOptions['journalService'],
      patchMeeting: vi.fn(async () => meeting),
      recordingSavingMode: 'new-doc',
      targetMeetingId: 'meeting-1',
      workspace: fixture.workspace,
      workspaceId: 'workspace-1',
    };
    return input;
  }

  test('waits for local document and workspace metadata writes before acknowledging a save', async () => {
    const fixture = createMeetingWorkspace();
    const input = createSaveInput(fixture);
    const index = vi
      .spyOn(workspaceIndex, 'syncWorkspaceContentIndex')
      .mockResolvedValue({ indexed: 1, total: 1, workspaceId: 'workspace-1' });
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    vi.mocked(input.docPersistence.waitForUpdated).mockImplementation(
      async () => gate
    );
    const save = executeMeetingSave(input);
    try {
      await vi.waitFor(() => {
        expect(input.docPersistence.waitForUpdated).toHaveBeenCalledWith(
          fixture.store.id
        );
      });
      expect(input.patchMeeting).not.toHaveBeenCalled();
      expect(index).not.toHaveBeenCalled();
      release();
      await save;
      expect(input.docPersistence.waitForUpdated).toHaveBeenNthCalledWith(
        2,
        fixture.workspace.doc.guid
      );
      expect(index).toHaveBeenCalledOnce();
      expect(input.patchMeeting).toHaveBeenCalledOnce();
    } finally {
      release();
      await save.catch(() => {});
      fixture.dispose();
    }
  });

  test('saves a generated summary before the existing transcript', async () => {
    const fixture = createMeetingWorkspace();
    const input = createSaveInput(fixture);
    const meeting = await input.getMeeting('meeting-1');
    const transcriptId = meetingContentBlockId(meeting.id, 'transcript');
    const summaryId = meetingContentBlockId(meeting.id, 'summary');
    meeting.summary = 'The team agreed to follow up tomorrow.';
    vi.spyOn(workspaceIndex, 'syncWorkspaceContentIndex').mockResolvedValue({
      indexed: 1,
      total: 1,
      workspaceId: 'workspace-1',
    });
    try {
      await appendMeetingMarkdownDoc({
        blockId: transcriptId,
        docId: fixture.store.id,
        markdown: 'User-corrected transcript',
        workspace: fixture.workspace,
      });
      await executeMeetingSave(input);
      const children = fixture.store.getModelById(fixture.pageId)?.children;
      const transcriptIndex = children?.findIndex(
        block => block.id === transcriptId
      );
      expect(children?.findIndex(block => block.id === summaryId)).toBe(
        (transcriptIndex ?? 0) - 1
      );
      expect(
        fixture.store
          .getModelById(transcriptId)
          ?.children.map(block => block.text?.toString())
      ).toContain('User-corrected transcript');
    } finally {
      fixture.dispose();
    }
  });

  test('does not acknowledge or index when local storage fails', async () => {
    const fixture = createMeetingWorkspace();
    const input = createSaveInput(fixture);
    const index = vi
      .spyOn(workspaceIndex, 'syncWorkspaceContentIndex')
      .mockResolvedValue({ indexed: 1, total: 1, workspaceId: 'workspace-1' });
    vi.mocked(input.docPersistence.waitForUpdated).mockRejectedValue(
      new Error('Local storage unavailable')
    );
    try {
      await expect(executeMeetingSave(input)).rejects.toThrow(
        'Local storage unavailable'
      );
      expect(input.patchMeeting).not.toHaveBeenCalled();
      expect(index).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  test('waits for the existing note to load before checking saved blocks', async () => {
    const fixture = createMeetingWorkspace();
    const input = createSaveInput(fixture);
    vi.mocked(input.docPersistence.waitForDocLoaded).mockRejectedValue(
      new Error('Load interrupted')
    );
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    try {
      await expect(executeMeetingSave(input)).rejects.toThrow(
        'Load interrupted'
      );
      expect(updates).not.toHaveBeenCalled();
      expect(input.patchMeeting).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  test('saves same-ID revisions without rewriting user edits or duplicating a failed save on retry', async () => {
    const fixture = createMeetingWorkspace();
    const input = createSaveInput(fixture);
    const meeting: MeetingSaveMeeting = {
      ...(await input.getMeeting('meeting-1')),
      transcriptSaveInitialized: true,
    };
    const segment = meeting.transcriptSegments![0];
    meeting.savedTranscriptSegmentIds = [segment.id];
    meeting.savedTranscriptSegmentSnapshots = {
      [segment.id]: meetingTranscriptSegmentSnapshot(segment),
    };
    const transcriptId = meetingContentBlockId(meeting.id, 'transcript');
    await appendMeetingMarkdownDoc({
      blockId: transcriptId,
      docId: fixture.store.id,
      markdown: 'User-corrected transcript',
      workspace: fixture.workspace,
    });
    segment.text = 'Follow up tomorrow with the revised budget.';
    vi.mocked(input.getMeeting).mockImplementation(async () => meeting);
    vi.mocked(input.patchMeeting).mockImplementation(async (_id, update) => {
      Object.assign(meeting, update);
      return meeting;
    });
    vi.spyOn(workspaceIndex, 'syncWorkspaceContentIndex')
      .mockRejectedValueOnce(new Error('Index temporarily unavailable'))
      .mockResolvedValue({ indexed: 1, total: 1, workspaceId: 'workspace-1' });

    const firstRecoveryId = meetingTranscriptRecoveryBlockId(meeting.id, [
      { ...segment },
    ]);
    try {
      await expect(executeMeetingSave(input)).rejects.toThrow(
        'Index temporarily unavailable'
      );
      expect(input.patchMeeting).not.toHaveBeenCalled();
      expect(Boolean(fixture.store.getBlock(firstRecoveryId))).toBe(true);

      const nextSegment = {
        ...segment,
        id: 'segment-2',
        text: 'Next decision.',
      };
      meeting.transcriptSegments!.push(nextSegment);
      await executeMeetingSave(input);
      expect(
        fixture.store
          .getModelById(fixture.pageId)!
          .children.filter(block => block.id === firstRecoveryId)
      ).toHaveLength(1);
      expect(
        fixture.store
          .getModelById(transcriptId)!
          .children.map(block => block.text?.toString())
      ).toContain('User-corrected transcript');
      expect(meeting.savedTranscriptSegmentSnapshots?.[segment.id]).toBe(
        meetingTranscriptSegmentSnapshot(segment)
      );
      const updates = vi.fn();
      fixture.store.spaceDoc.on('update', updates);
      await executeMeetingSave(input);
      expect(updates).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  test('acknowledges only the transcript version captured before async save work', async () => {
    const fixture = createMeetingWorkspace();
    const input = createSaveInput(fixture);
    const meeting = await input.getMeeting('meeting-1');
    const segment = meeting.transcriptSegments![0];
    const expectedSnapshot = meetingTranscriptSegmentSnapshot(segment);
    vi.mocked(input.docPersistence.waitForDocLoaded).mockImplementation(
      async () => {
        segment.text = 'New content arriving during the save';
      }
    );
    vi.spyOn(workspaceIndex, 'syncWorkspaceContentIndex').mockResolvedValue({
      indexed: 1,
      total: 1,
      workspaceId: 'workspace-1',
    });
    try {
      await executeMeetingSave(input);
      expect(input.patchMeeting).toHaveBeenCalledWith(
        meeting.id,
        expect.objectContaining({
          savedTranscriptSegmentSnapshots: {
            [segment.id]: expectedSnapshot,
          },
        })
      );
    } finally {
      fixture.dispose();
    }
  });

  test('reloads the saved transcript from nbstore local storage after acknowledgement', async () => {
    const fixture = createMeetingWorkspace();
    const storage = new IndexedDBDocStorage({
      id: fixture.workspace.doc.guid,
      flavour: 'local',
      type: 'workspace',
    });
    storage.connection.connect();
    await storage.connection.waitForConnected();
    const frontend = new DocFrontend(storage, DocSyncImpl.dummy);
    frontend.start();
    frontend.connectDoc(fixture.workspace.doc);
    frontend.connectDoc(fixture.store.spaceDoc);
    await frontend.waitForDocLoaded(fixture.store.id);
    await frontend.waitForUpdated(fixture.store.id);
    await frontend.waitForUpdated(fixture.workspace.doc.guid);
    const input = createSaveInput(fixture);
    input.docPersistence = frontend;
    vi.spyOn(workspaceIndex, 'syncWorkspaceContentIndex').mockResolvedValue({
      indexed: 1,
      total: 1,
      workspaceId: 'workspace-1',
    });
    const restoredRoot = new YDoc();
    const restored = new WorkspaceImpl({
      id: 'workspace-1',
      rootDoc: restoredRoot,
    });
    restored.meta.initialize();
    try {
      await executeMeetingSave(input);
      expect(input.patchMeeting).toHaveBeenCalledOnce();
      const persisted = await storage.getDoc(fixture.store.id);
      expect(persisted).not.toBeNull();
      const restoredDoc = restored.createDoc(fixture.store.id);
      restoredDoc.load();
      applyUpdate(restoredDoc.spaceDoc, persisted!.bin);
      const restoredStore = restoredDoc.getStore();
      const recoveryId = meetingTranscriptRecoveryBlockId(
        input.targetMeetingId,
        (await input.getMeeting(input.targetMeetingId)).transcriptSegments!
      );
      expect(
        restoredStore
          .getModelById(recoveryId)!
          .children.map(block => block.text?.toString())
      ).toContain('[00:00 - 00:01] Speaker: Follow up tomorrow.');
      expect(
        restoredStore
          .getModelById(fixture.existingParagraphId)
          ?.text?.toString()
      ).toBe('User notes');
    } finally {
      frontend.stop();
      await new Promise(resolve => setTimeout(resolve, 0));
      storage.connection.disconnect();
      restored.dispose();
      restoredRoot.destroy();
      fixture.dispose();
    }
  });

  test('shares one in-flight mutation between route and workspace workers', async () => {
    let resolveExecution: ((value: string) => void) | undefined;
    const execution = new Promise<string>(resolve => {
      resolveExecution = resolve;
    });
    const execute = vi.fn(() => execution);

    const routeSave = runMeetingSaveOnce('workspace-1:meeting-1', execute);
    const workspaceSave = runMeetingSaveOnce('workspace-1:meeting-1', execute);

    expect(workspaceSave).toBe(routeSave);
    expect(execute).toHaveBeenCalledOnce();

    resolveExecution?.('meeting-note-1');
    await expect(routeSave).resolves.toBe('meeting-note-1');

    await expect(
      runMeetingSaveOnce(
        'workspace-1:meeting-1',
        async () => 'meeting-note-after-completion'
      )
    ).resolves.toBe('meeting-note-after-completion');
  });

  test('treats a missing legacy microphone spool as no mic attachment', async () => {
    const handler: MeetingSaveMicExportAccess = {
      getMicAudioSpoolStatus: vi.fn(async () => null),
      getPublishedMicRecordingPath: vi.fn(async () => null),
      publishMicRecording: vi.fn(),
      readMicAudioSpoolArchive: vi.fn(),
    };

    await expect(
      finalizePortableMeetingMicRecording(handler, 'legacy-meeting')
    ).resolves.toBeNull();
    expect(handler.publishMicRecording).not.toHaveBeenCalled();
    expect(handler.readMicAudioSpoolArchive).not.toHaveBeenCalled();
  });

  test('keeps a real pending microphone spool retryable', async () => {
    const handler: MeetingSaveMicExportAccess = {
      getMicAudioSpoolStatus: vi.fn(async () => ({
        archiveBytes: 64,
        channels: 1,
        closed: true,
        pendingBytes: 16,
        sampleRate: 16_000,
      })),
      getPublishedMicRecordingPath: vi.fn(async () => null),
      publishMicRecording: vi.fn(),
      readMicAudioSpoolArchive: vi.fn(),
    };

    await expect(
      finalizePortableMeetingMicRecording(handler, 'pending-meeting')
    ).rejects.toThrow('16 bytes waiting');
    expect(handler.publishMicRecording).not.toHaveBeenCalled();
  });
});
