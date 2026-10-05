/**
 * @vitest-environment happy-dom
 */
import { Text } from '@blocksuite/affine/store';
import { MarkdownTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import * as workspaceIndex from '../ai-workspace-index';
import {
  meetingTranscriptRecoveryBlockId,
  meetingTranscriptSegmentSnapshot,
} from './meeting-save';
import {
  executeMeetingSave,
  type ExecuteMeetingSaveOptions,
  type MeetingSaveMeeting,
} from './meeting-save-executor';

afterEach(() => {
  vi.restoreAllMocks();
});

function createSaveFixture() {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id: 'workspace-1', rootDoc });
  workspace.meta.initialize();
  const doc = workspace.createDoc('meeting-note');
  doc.load();
  const store = doc.getStore();
  const pageId = store.addBlock('affine:page', { title: new Text('Meeting') });
  const noteId = store.addBlock('affine:note', {}, pageId);
  const paragraphId = store.addBlock(
    'affine:paragraph',
    { text: new Text('User notes') },
    noteId
  );
  store.resetHistory();

  // A legacy backend link requires recovery of every final segment.
  const segments = [
    'Confirm the revised budget.',
    'Follow up tomorrow.',
    'Publish the final decision.',
  ].map((text, index) => ({
    id: `segment-${index + 1}`,
    source: 'mic' as const,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    text,
    type: 'final' as const,
  }));
  const meeting: MeetingSaveMeeting = {
    createdAt: '2026-09-13T10:00:00Z',
    docId: store.id,
    id: 'meeting-1',
    status: 'stopped',
    stt: { status: 'stopped' },
    transcriptSegments: segments,
    updatedAt: '2026-09-13T11:00:00Z',
    workspaceId: workspace.id,
  };
  const recoveryIds = segments.map(segment =>
    meetingTranscriptRecoveryBlockId(meeting.id, [segment])
  );
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
      // eslint-disable-next-line rxjs/finnish
      journalDate$: () => ({ value: null }),
    } as unknown as ExecuteMeetingSaveOptions['journalService'],
    patchMeeting: vi.fn(async () => meeting),
    recordingSavingMode: 'new-doc',
    targetMeetingId: meeting.id,
    workspace,
    workspaceId: workspace.id,
  };
  const index = vi
    .spyOn(workspaceIndex, 'syncWorkspaceContentIndex')
    .mockResolvedValue({ indexed: 1, total: 1, workspaceId: workspace.id });

  return {
    store,
    pageId,
    paragraphId,
    input,
    index,
    segments,
    recoveryIds,
    addLiveRecovery: (blockId: string, text: string) => {
      store.transact(() => {
        store.addBlock('affine:note', { id: blockId }, pageId);
        store.addBlock('affine:paragraph', { text: new Text(text) }, blockId);
      });
    },
    recoveryText: (blockId: string) =>
      store
        .getModelById(blockId)!
        .children.map(block => block.text?.toString() ?? '')
        .join('\n'),
    dispose: () => {
      workspace.dispose();
      rootDoc.destroy();
    },
  };
}

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

function expectRecoveryReferences(
  fixture: ReturnType<typeof createSaveFixture>
) {
  const children = fixture.store.getModelById(fixture.pageId)!.children;
  for (const id of fixture.recoveryIds) {
    expect(children.filter(child => child.id === id)).toHaveLength(1);
  }
}

describe('atomic meeting transcript recovery batch', () => {
  test('stages only missing segments together and preserves an existing edited recovery block', async () => {
    const fixture = createSaveFixture();
    const [existingId, ...missingIds] = fixture.recoveryIds;
    fixture.addLiveRecovery(existingId, 'User-corrected recovery');
    const importer = vi.spyOn(MarkdownTransformer, 'importMarkdownToBlock');
    const updates = vi.fn(() =>
      fixture.recoveryIds.map(id => Boolean(fixture.store.getBlock(id)))
    );
    fixture.store.spaceDoc.on('update', updates);
    try {
      const result = await executeMeetingSave(fixture.input);

      expect(result).toMatchObject({
        contentAdded: true,
        destination: 'new-doc',
        docId: fixture.store.id,
      });
      expect(importer.mock.calls.map(([options]) => options.blockId)).toEqual(
        missingIds
      );
      expect(
        new Set(importer.mock.calls.map(([options]) => options.doc.spaceDoc))
          .size
      ).toBe(1);
      expect(importer.mock.calls[0][0].doc.spaceDoc).not.toBe(
        fixture.store.spaceDoc
      );
      expect(updates).toHaveBeenCalledOnce();
      expect(updates.mock.results[0].value).toEqual([true, true, true]);
      expect(fixture.recoveryText(existingId)).toBe('User-corrected recovery');
      for (const [offset, id] of missingIds.entries()) {
        expect(fixture.recoveryText(id)).toContain(
          fixture.segments[offset + 1].text
        );
      }
      expectRecoveryReferences(fixture);
      expect(fixture.input.patchMeeting).toHaveBeenCalledWith(
        fixture.input.targetMeetingId,
        expect.objectContaining({
          savedTranscriptSegmentIds: fixture.segments.map(
            segment => segment.id
          ),
          savedTranscriptSegmentSnapshots: Object.fromEntries(
            fixture.segments.map(segment => [
              segment.id,
              meetingTranscriptSegmentSnapshot(segment),
            ])
          ),
        })
      );

      importer.mockClear();
      updates.mockClear();
      await executeMeetingSave(fixture.input);
      expect(importer).not.toHaveBeenCalled();
      expect(updates).not.toHaveBeenCalled();
      expectRecoveryReferences(fixture);
    } finally {
      fixture.dispose();
    }
  });

  test('discards the entire batch when the second import fails and retries every missing segment', async () => {
    const fixture = createSaveFixture();
    const original = MarkdownTransformer.importMarkdownToBlock;
    const importer = vi
      .spyOn(MarkdownTransformer, 'importMarkdownToBlock')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async options => {
        options.doc.addBlock(
          'affine:paragraph',
          { text: new Text('Incomplete second import') },
          options.blockId
        );
        throw new Error('Second segment import interrupted');
      });
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    try {
      await expect(executeMeetingSave(fixture.input)).rejects.toThrow(
        'Second segment import interrupted'
      );
      expect(importer).toHaveBeenCalledTimes(2);
      expect(importer.mock.calls[0][0].doc.spaceDoc).toBe(
        importer.mock.calls[1][0].doc.spaceDoc
      );
      expect(updates).not.toHaveBeenCalled();
      for (const id of fixture.recoveryIds) {
        expect(Boolean(fixture.store.getBlock(id))).toBe(false);
      }
      expect(
        fixture.input.docPersistence.waitForUpdated
      ).not.toHaveBeenCalled();
      expect(fixture.index).not.toHaveBeenCalled();
      expect(fixture.input.patchMeeting).not.toHaveBeenCalled();

      importer.mockClear();
      await executeMeetingSave(fixture.input);
      expect(importer.mock.calls.map(([options]) => options.blockId)).toEqual(
        fixture.recoveryIds
      );
      expect(updates).toHaveBeenCalledOnce();
      for (const [offset, id] of fixture.recoveryIds.entries()) {
        expect(fixture.recoveryText(id)).toContain(
          fixture.segments[offset].text
        );
        expect(fixture.recoveryText(id)).not.toContain(
          'Incomplete second import'
        );
      }
      expectRecoveryReferences(fixture);
      expect(fixture.index).toHaveBeenCalledOnce();
      expect(fixture.input.patchMeeting).toHaveBeenCalledOnce();
    } finally {
      fixture.dispose();
    }
  });

  test('keeps the batch unpublished during the second import and preserves a concurrent live text edit', async () => {
    const fixture = createSaveFixture();
    const original = MarkdownTransformer.importMarkdownToBlock;
    const gate = createGate();
    const importer = vi
      .spyOn(MarkdownTransformer, 'importMarkdownToBlock')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async options => {
        await gate.promise;
        await original(options);
      });
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    const save = executeMeetingSave(fixture.input);
    try {
      await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(2));
      for (const id of fixture.recoveryIds) {
        expect(Boolean(fixture.store.getBlock(id))).toBe(false);
      }
      expect(updates).not.toHaveBeenCalled();
      expect(
        fixture.input.docPersistence.waitForUpdated
      ).not.toHaveBeenCalled();
      expect(fixture.input.patchMeeting).not.toHaveBeenCalled();
      const text = fixture.store.getModelById(fixture.paragraphId)!.text!;
      text.insert(' updated', text.length);
      updates.mockClear();

      gate.release();
      await save;
      expect(updates).toHaveBeenCalledOnce();
      expect(
        fixture.store.getModelById(fixture.paragraphId)!.text!.toString()
      ).toBe('User notes updated');
      for (const [offset, id] of fixture.recoveryIds.entries()) {
        expect(fixture.recoveryText(id)).toContain(
          fixture.segments[offset].text
        );
      }
      expectRecoveryReferences(fixture);
    } finally {
      gate.release();
      await save.catch(() => {});
      fixture.dispose();
    }
  });

  test('rejects a partially concurrent batch without publishing and retries only remaining IDs', async () => {
    const fixture = createSaveFixture();
    const original = MarkdownTransformer.importMarkdownToBlock;
    const gate = createGate();
    const importer = vi
      .spyOn(MarkdownTransformer, 'importMarkdownToBlock')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async options => {
        await gate.promise;
        await original(options);
      });
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    const save = executeMeetingSave(fixture.input);
    try {
      await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(2));
      const [concurrentId, ...missingIds] = fixture.recoveryIds;
      fixture.addLiveRecovery(
        concurrentId,
        'Concurrent user-corrected recovery'
      );
      updates.mockClear();
      const rejection = expect(save).rejects.toThrow(
        'Meeting content changed during import. Retry saving.'
      );
      gate.release();
      await rejection;

      expect(updates).not.toHaveBeenCalled();
      expect(fixture.recoveryText(concurrentId)).toBe(
        'Concurrent user-corrected recovery'
      );
      for (const id of missingIds) {
        expect(Boolean(fixture.store.getBlock(id))).toBe(false);
      }
      expect(
        fixture.input.docPersistence.waitForUpdated
      ).not.toHaveBeenCalled();
      expect(fixture.index).not.toHaveBeenCalled();
      expect(fixture.input.patchMeeting).not.toHaveBeenCalled();

      importer.mockClear();
      await executeMeetingSave(fixture.input);
      expect(importer.mock.calls.map(([options]) => options.blockId)).toEqual(
        missingIds
      );
      expect(updates).toHaveBeenCalledOnce();
      expect(fixture.recoveryText(concurrentId)).toBe(
        'Concurrent user-corrected recovery'
      );
      for (const [offset, id] of missingIds.entries()) {
        expect(fixture.recoveryText(id)).toContain(
          fixture.segments[offset + 1].text
        );
      }
      expectRecoveryReferences(fixture);
      expect(fixture.input.patchMeeting).toHaveBeenCalledOnce();
    } finally {
      gate.release();
      await save.catch(() => {});
      fixture.dispose();
    }
  });

  test('discards staged content when every requested ID appears concurrently', async () => {
    const fixture = createSaveFixture();
    const original = MarkdownTransformer.importMarkdownToBlock;
    const gate = createGate();
    const importer = vi
      .spyOn(MarkdownTransformer, 'importMarkdownToBlock')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async options => {
        await gate.promise;
        await original(options);
      });
    const updates = vi.fn();
    fixture.store.spaceDoc.on('update', updates);
    const save = executeMeetingSave(fixture.input);
    try {
      await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(2));
      for (const id of fixture.recoveryIds) {
        fixture.addLiveRecovery(id, `Concurrent content for ${id}`);
      }
      updates.mockClear();

      gate.release();
      await save;
      expect(importer).toHaveBeenCalledTimes(fixture.recoveryIds.length);
      expect(updates).not.toHaveBeenCalled();
      for (const id of fixture.recoveryIds) {
        expect(fixture.recoveryText(id)).toBe(`Concurrent content for ${id}`);
      }
      expectRecoveryReferences(fixture);
      expect(
        fixture.input.docPersistence.waitForUpdated
      ).toHaveBeenNthCalledWith(1, fixture.store.id);
      expect(
        fixture.input.docPersistence.waitForUpdated
      ).toHaveBeenNthCalledWith(2, fixture.input.workspace.doc.guid);
      expect(fixture.index).toHaveBeenCalledOnce();
      expect(fixture.input.patchMeeting).toHaveBeenCalledOnce();
    } finally {
      gate.release();
      await save.catch(() => {});
      fixture.dispose();
    }
  });
});
