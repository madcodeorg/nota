import type { Workspace } from '@blocksuite/affine/store';
import { MarkdownTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { getStoreManager } from '@nota/core/blocksuite/manager/store';
import type { DocsService } from '@nota/core/modules/doc';
import type { JournalService } from '@nota/core/modules/journal';
import type { GuardService } from '@nota/core/modules/permissions';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { encodeFloat32ArchiveToOpus } from '@nota/core/utils/opus-encoding';
import dayjs from 'dayjs';
import {
  applyUpdate,
  Doc as YDoc,
  encodeStateAsUpdate,
  encodeStateVector,
} from 'yjs';

import {
  syncWorkspaceContentIndex,
  type WorkspaceContentAccessForDocument,
} from '../ai-workspace-index';
import type { MeetingSaveStorage } from './meeting-pending-save';
import { removePendingMeetingSaveJob } from './meeting-pending-save';
import {
  isPortableMeetingRecordingBlock,
  isRawMeetingRecording,
  meetingRawRecordingPlaceholderBlockId,
  meetingRecordingPathOnlyMarkdown,
} from './meeting-recording';
import {
  findReusableMeetingDocId,
  isMeetingTranscriptionPending,
  meetingContentBlockId,
  meetingDocumentId,
  meetingNoteMarkdown,
  meetingSummarySectionMarkdown,
  MeetingTranscriptPendingError,
  meetingTranscriptRecoveryBlockId,
  meetingTranscriptRecoveryMarkdown,
  meetingTranscriptRecoverySegments,
  meetingTranscriptSaveDelta,
  resolveMeetingRecordingParentBlockId,
  resolveMeetingSaveDestination,
  type SavedMeeting,
  type SavedMeetingTranscriptSegment,
} from './meeting-save';
import { runMeetingSaveOnce } from './meeting-save-dedupe';

export type MeetingSaveDestination = 'journal-today' | 'new-doc';

export type MeetingSaveMeeting = SavedMeeting & {
  docId?: string | null;
  savedTranscriptSegmentIds?: string[];
  status: 'recording' | 'stopped';
  summary?: string | null;
  summaryDocIds?: string[];
  transcriptSaveInitialized?: boolean;
  transcriptSegments?: SavedMeetingTranscriptSegment[];
  workspaceId?: string | null;
};

export type MeetingSaveRecordingAccess = {
  readRecordingFile: (filepath: string) => Promise<unknown>;
};

export type MeetingSaveMicExportAccess = {
  getMicAudioSpoolStatus: (meetingId: string) => Promise<{
    archiveBytes: number;
    channels: number;
    closed: boolean;
    pendingBytes: number;
    sampleRate: number;
  } | null>;
  getPublishedMicRecordingPath: (meetingId: string) => Promise<string | null>;
  publishMicRecording: (
    meetingId: string,
    encoded: Uint8Array
  ) => Promise<string>;
  readMicAudioSpoolArchive: (
    meetingId: string,
    cursor: number,
    maximumBytes: number
  ) => Promise<{ buffer: unknown; nextCursor: number }>;
};

export type MeetingSaveResult = {
  contentAdded: boolean;
  destination: MeetingSaveDestination;
  docId: string;
  meeting: MeetingSaveMeeting;
};

export type ExecuteMeetingSaveOptions = {
  accessForWorkspaceDocument: WorkspaceContentAccessForDocument;
  assertCanCreateWorkspaceDocument: () => Promise<void>;
  assertCanUpdateWorkspaceDocument: (docId: string) => Promise<void>;
  current?: {
    docId?: string | null;
    meetingId: string;
    recordingPath?: string | null;
    transcriptSegments?: SavedMeetingTranscriptSegment[];
  };
  docsService: DocsService;
  docPersistence: {
    waitForDocLoaded: (docId: string) => Promise<void>;
    waitForUpdated: (docId: string) => Promise<void>;
  };
  finalizePortableMicRecording?: (meetingId: string) => Promise<string | null>;
  getMeeting: (meetingId: string) => Promise<MeetingSaveMeeting>;
  journalService: JournalService;
  patchMeeting: (
    meetingId: string,
    update: {
      docId: string;
      microphoneRecordingPath?: string;
      recordingPath?: string;
      savedTranscriptSegmentIds: string[];
      savedTranscriptSegmentSnapshots: Record<string, string>;
      summaryDocId?: string;
    }
  ) => Promise<MeetingSaveMeeting>;
  recordingAccess?: MeetingSaveRecordingAccess | null;
  recordingSavingMode: MeetingSaveDestination;
  storage?: MeetingSaveStorage | null;
  targetMeetingId: string;
  workspace: Workspace;
  workspaceId: string;
};

function transformerExtensions() {
  return getStoreManager().config.init().value.get('store');
}

async function ensureMeetingDoc(options: {
  docId: string;
  docsService: DocsService;
  title: string;
  workspace: Workspace;
}) {
  if (!options.workspace.getDoc(options.docId)?.getStore()) {
    options.docsService.createDoc({ id: options.docId, title: options.title });
  }
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(`Failed to create meeting note: ${options.docId}`);
  }
  doc.load();
  return options.docId;
}

export function workspaceDocExists(workspace: Workspace, docId: string) {
  return Boolean(workspace.getDoc(docId)?.getStore());
}

export function workspaceDocHasBlock(
  workspace: Workspace,
  docId: string,
  blockId: string
) {
  const doc = workspace.getDoc(docId)?.getStore();
  if (!doc) {
    return false;
  }
  doc.load();
  return Boolean(doc.getBlock(blockId));
}

function workspaceDocHasRecordingAttachment(
  workspace: Workspace,
  docId: string,
  blockId: string,
  filepath: string
) {
  const doc = workspace.getDoc(docId)?.getStore();
  if (!doc) {
    return false;
  }
  doc.load();
  if (isPortableMeetingRecordingBlock(doc.getBlock(blockId)?.model.flavour)) {
    return true;
  }
  const filename = filepath.split(/[\\/]/).pop();
  if (!filename) {
    return false;
  }
  return doc.getBlocksByFlavour('affine:attachment').some(block => {
    const props = block.model.props as { name?: string };
    return props.name === filename;
  });
}

function workspaceDocBlockHasParent(
  workspace: Workspace,
  docId: string,
  blockId: string,
  parentBlockId: string
) {
  const doc = workspace.getDoc(docId)?.getStore();
  const block = doc?.getBlock(blockId);
  if (!doc || !block) {
    return false;
  }
  return doc.getParent(block.model)?.id === parentBlockId;
}

export async function appendMeetingMarkdownDoc(options: {
  beforeBlockId?: string;
  blockId?: string;
  docId: string;
  markdown: string;
  workspace: Workspace;
}) {
  const [blockId] = await appendMeetingMarkdownBlocks({
    ...options,
    blocks: [{ blockId: options.blockId, markdown: options.markdown }],
  });
  return blockId;
}

async function appendMeetingMarkdownBlocks(options: {
  beforeBlockId?: string;
  blocks: Array<{ blockId?: string; markdown: string }>;
  docId: string;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(`Doc not found: ${options.docId}`);
  }

  doc.load();
  const pageBlockId = doc.getBlocksByFlavour('affine:page')[0]?.id;
  if (!pageBlockId) {
    throw new Error(`Doc has no page block: ${options.docId}`);
  }

  const pending = options.blocks.filter(
    block => !block.blockId || !doc.getBlock(block.blockId)
  );
  const requireBlockId = (block: { blockId?: string }) => {
    if (!block.blockId) {
      throw new Error('Meeting markdown block has no identifier.');
    }
    return block.blockId;
  };
  if (!pending.length) {
    const page = doc.getModelById(pageBlockId);
    const before = options.beforeBlockId
      ? doc.getModelById(options.beforeBlockId)
      : null;
    if (page && before && page.children.includes(before)) {
      for (const block of options.blocks) {
        const existing = doc.getModelById(requireBlockId(block));
        if (
          existing &&
          page.children.indexOf(existing) > page.children.indexOf(before)
        ) {
          if (doc.readonly) {
            throw new Error(
              'Cannot reorder meeting content in a read-only document.'
            );
          }
          doc.captureSync();
          doc.moveBlocks([existing], page, before, true);
          doc.captureSync();
        }
      }
    }
    return options.blocks.map(requireBlockId);
  }

  // Async imports must not publish the idempotency block before its contents.
  // Prepare in an unconnected workspace, then publish only the complete delta.
  const rootDoc = new YDoc();
  const stagingWorkspace = new WorkspaceImpl({
    id: options.workspace.id,
    rootDoc,
    blobSource: options.workspace.blobSync.main,
  });
  stagingWorkspace.meta.initialize();
  try {
    const stagingDoc = stagingWorkspace.createDoc(doc.id);
    stagingDoc.load();
    const stagingStore = stagingDoc.getStore();
    applyUpdate(stagingStore.spaceDoc, encodeStateAsUpdate(doc.spaceDoc));
    const baseline = encodeStateVector(stagingStore.spaceDoc);
    const added = new Map<(typeof pending)[number], string>();
    for (const block of pending) {
      const beforeIndex = stagingStore
        .getModelById(pageBlockId)
        ?.children.findIndex(child => child.id === options.beforeBlockId);
      const blockId = stagingStore.addBlock(
        'affine:note',
        block.blockId ? { id: block.blockId } : {},
        pageBlockId,
        beforeIndex !== undefined && beforeIndex >= 0 ? beforeIndex : undefined
      );
      await MarkdownTransformer.importMarkdownToBlock({
        doc: stagingStore,
        blockId,
        markdown: `---\n\n${block.markdown}`,
        extensions: transformerExtensions(),
      });
      if (!stagingStore.getModelById(blockId)?.children.length) {
        throw new Error('Meeting markdown import produced no content.');
      }
      added.set(block, blockId);
    }
    const blockIds = options.blocks.map(
      block => added.get(block) ?? requireBlockId(block)
    );
    const concurrentBlocks = pending.filter(
      block => block.blockId && doc.getBlock(block.blockId)
    );
    if (concurrentBlocks.length === pending.length) {
      return blockIds;
    }
    if (concurrentBlocks.length) {
      throw new Error('Meeting content changed during import. Retry saving.');
    }
    if (
      options.workspace.getDoc(options.docId)?.spaceDoc !== doc.spaceDoc ||
      !doc.getBlock(pageBlockId)
    ) {
      throw new Error('Meeting note changed while its content was importing.');
    }
    doc.captureSync();
    applyUpdate(
      doc.spaceDoc,
      encodeStateAsUpdate(stagingStore.spaceDoc, baseline),
      doc.spaceDoc.clientID
    );
    doc.captureSync();
    return blockIds;
  } finally {
    stagingWorkspace.dispose();
    rootDoc.destroy();
  }
}

function toAudioBytes(buffer: unknown) {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  if (
    buffer &&
    typeof buffer === 'object' &&
    Array.isArray((buffer as { data?: unknown }).data)
  ) {
    return new Uint8Array((buffer as { data: number[] }).data);
  }
  return new Uint8Array();
}

async function attachRecordingToDoc(options: {
  blockId: string;
  docId: string;
  filepath: string | null;
  parentBlockId?: string | null;
  recordingAccess?: MeetingSaveRecordingAccess | null;
  workspace: Workspace;
}) {
  if (!options.filepath) {
    return null;
  }

  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(`Doc not found: ${options.docId}`);
  }
  doc.load();
  const existing = doc.getBlock(options.blockId);
  if (isPortableMeetingRecordingBlock(existing?.model.flavour)) {
    if (options.parentBlockId) {
      const requestedParent = doc.getBlock(options.parentBlockId)?.model;
      if (!requestedParent) {
        throw new Error(
          `Meeting recording parent is unavailable: ${options.parentBlockId}`
        );
      }
      if (doc.getParent(existing.model)?.id !== options.parentBlockId) {
        doc.moveBlocks([existing.model], requestedParent);
      }
    }
    return { blockId: options.blockId, sourceId: null };
  }
  if (existing) {
    // Older raw placeholders reused the future attachment id. Remove that
    // non-attachment block so a portable retry can create the real blob.
    doc.deleteBlock(existing.id);
  }

  if (isRawMeetingRecording(options.filepath)) {
    const rawPlaceholderBlockId = meetingRawRecordingPlaceholderBlockId(
      options.blockId
    );
    const blockId = await appendMeetingMarkdownDoc({
      blockId: rawPlaceholderBlockId,
      docId: options.docId,
      markdown: meetingRecordingPathOnlyMarkdown(options.filepath),
      workspace: options.workspace,
    });
    return { blockId, sourceId: null };
  }

  const recordingUrl = new URL('assets://local-file');
  recordingUrl.pathname = options.filepath.replace(/\\/g, '/');
  let blob: Blob;
  try {
    const response = await fetch(recordingUrl);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    blob = await response.blob();
  } catch {
    if (!options.recordingAccess) {
      throw new Error('Desktop recording attachment access is unavailable.');
    }
    const raw = await options.recordingAccess.readRecordingFile(
      options.filepath
    );
    const bytes = toAudioBytes(raw);
    blob = new Blob([
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
    ]);
  }
  if (!blob.size) {
    throw new Error(`The meeting recording is empty: ${options.filepath}`);
  }

  const parentBlockId = options.parentBlockId;
  if (!parentBlockId || !doc.getBlock(parentBlockId)) {
    throw new Error(
      `Meeting recording parent is unavailable: ${options.docId}`
    );
  }
  const name = options.filepath.split(/[\\/]/).pop() || 'meeting-recording.raw';
  const inferredType = /\.(?:m4a|mp4|opus)$/i.test(name)
    ? 'audio/mp4'
    : /\.webm$/i.test(name)
      ? 'audio/webm'
      : 'application/octet-stream';
  const type =
    blob.type && blob.type !== 'application/octet-stream'
      ? blob.type
      : inferredType;
  const sourceBlob = blob.type === type ? blob : new Blob([blob], { type });
  const sourceId = await doc.blobSync.set(sourceBlob);
  const blockId = doc.addBlock(
    'affine:attachment',
    {
      embed: false,
      name,
      size: sourceBlob.size,
      sourceId,
      type,
      id: options.blockId,
    },
    parentBlockId
  );
  const rawPlaceholder = doc.getBlock(
    meetingRawRecordingPlaceholderBlockId(options.blockId)
  );
  if (rawPlaceholder) {
    doc.deleteBlock(rawPlaceholder.id);
  }
  return { blockId, sourceId };
}

async function ensureMeetingRecordingParent(options: {
  destination: MeetingSaveDestination;
  docId: string;
  meetingId: string;
  workspace: Workspace;
}) {
  const parentBlockId = resolveMeetingRecordingParentBlockId({
    blockExists: blockId =>
      workspaceDocHasBlock(options.workspace, options.docId, blockId),
    meetingId: options.meetingId,
  });
  if (!workspaceDocHasBlock(options.workspace, options.docId, parentBlockId)) {
    await appendMeetingMarkdownDoc({
      blockId: parentBlockId,
      docId: options.docId,
      markdown: `${
        options.destination === 'journal-today' ? '###' : '##'
      } Meeting recordings`,
      workspace: options.workspace,
    });
  }
  return parentBlockId;
}

function pendingMeetingDocStorageKey(workspaceId: string, meetingId: string) {
  return `nota:meeting-note-target:v1:${workspaceId}:${meetingId}`;
}

function readPendingMeetingDocId(
  storage: MeetingSaveStorage | null | undefined,
  workspaceId: string,
  meetingId: string
) {
  try {
    return storage?.getItem(
      pendingMeetingDocStorageKey(workspaceId, meetingId)
    );
  } catch {
    return null;
  }
}

function writePendingMeetingDocId(
  storage: MeetingSaveStorage | null | undefined,
  workspaceId: string,
  meetingId: string,
  docId: string
) {
  try {
    storage?.setItem(
      pendingMeetingDocStorageKey(workspaceId, meetingId),
      docId
    );
  } catch {
    // The deterministic new-document id still prevents duplicate notes when
    // localStorage is unavailable. Journal recovery remains manually retryable.
  }
}

function clearPendingMeetingDocId(
  storage: MeetingSaveStorage | null | undefined,
  workspaceId: string,
  meetingId: string
) {
  try {
    storage?.removeItem(pendingMeetingDocStorageKey(workspaceId, meetingId));
  } catch {
    // Ignore unavailable localStorage after the durable backend link succeeds.
  }
}

function meetingTitle(meeting: MeetingSaveMeeting) {
  const parsed = dayjs(meeting.createdAt);
  return `Meeting ${parsed.isValid() ? parsed.format('MMM D, h:mm A') : 'Meeting'}`;
}

function assertMeetingWorkspace(
  meeting: MeetingSaveMeeting,
  workspaceId: string
) {
  if (meeting.workspaceId !== workspaceId) {
    throw new Error(
      'This meeting belongs to a different workspace and cannot be opened or saved here.'
    );
  }
}

export async function finalizePortableMeetingMicRecording(
  handler: MeetingSaveMicExportAccess,
  meetingId: string
) {
  const published = await handler.getPublishedMicRecordingPath(meetingId);
  if (published) {
    return published;
  }

  let status: Awaited<
    ReturnType<MeetingSaveMicExportAccess['getMicAudioSpoolStatus']>
  >;
  try {
    status = await handler.getMicAudioSpoolStatus(meetingId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Microphone spool for meeting') &&
      error.message.includes('was not found')
    ) {
      return null;
    }
    throw error;
  }
  if (!status?.archiveBytes) {
    return null;
  }
  if (!status.closed || status.pendingBytes !== 0) {
    throw new Error(
      `Microphone recording still has ${status.pendingBytes} bytes waiting for durable transcription acknowledgement.`
    );
  }

  const encoded = await encodeFloat32ArchiveToOpus({
    numberOfChannels: status.channels,
    read: async (cursor, maximumBytes) => {
      const chunk = await handler.readMicAudioSpoolArchive(
        meetingId,
        cursor,
        maximumBytes
      );
      return {
        buffer: toAudioBytes(chunk.buffer),
        nextCursor: chunk.nextCursor,
      };
    },
    sampleRate: status.sampleRate,
  });
  return handler.publishMicRecording(meetingId, encoded);
}

export function createMeetingSavePermissionContext(input: {
  guardService?: GuardService | null;
  userOwnedWorkspace: boolean;
}) {
  return {
    accessForWorkspaceDocument: (async ({ docId }) => {
      if (input.userOwnedWorkspace) {
        return { readable: true, visibility: 'workspace' as const };
      }
      if (!input.guardService) {
        return { readable: false, visibility: 'workspace' as const };
      }
      try {
        return {
          readable: await input.guardService.can('Doc_Read', docId),
          visibility: 'workspace' as const,
        };
      } catch (error) {
        console.warn('Failed to check doc read permission for AI index', error);
        return { readable: false, visibility: 'workspace' as const };
      }
    }) satisfies WorkspaceContentAccessForDocument,
    assertCanCreateWorkspaceDocument: async () => {
      if (input.userOwnedWorkspace) {
        return;
      }
      if (
        !input.guardService ||
        !(await input.guardService.can('Workspace_CreateDoc'))
      ) {
        throw new Error(
          'You do not have permission to create a meeting note in this workspace.'
        );
      }
    },
    assertCanUpdateWorkspaceDocument: async (docId: string) => {
      if (input.userOwnedWorkspace) {
        return;
      }
      if (
        !input.guardService ||
        !(await input.guardService.can('Doc_Update', docId))
      ) {
        throw new Error(
          'You do not have permission to update this meeting note.'
        );
      }
    },
  };
}

export async function executeMeetingSave(
  input: ExecuteMeetingSaveOptions
): Promise<MeetingSaveResult> {
  const meeting = await input.getMeeting(input.targetMeetingId);
  assertMeetingWorkspace(meeting, input.workspaceId);
  if (meeting.status !== 'stopped') {
    throw new Error(
      'Meeting finalization has not completed. Retry Stop before saving.'
    );
  }
  if (isMeetingTranscriptionPending(meeting.stt?.status)) {
    throw new MeetingTranscriptPendingError();
  }

  const {
    finalTranscriptSegments,
    missingTranscriptSegments,
    transcriptSegmentSnapshots,
  } = meetingTranscriptSaveDelta({
    savedTranscriptSegmentIds: meeting.savedTranscriptSegmentIds,
    savedTranscriptSegmentSnapshots: meeting.savedTranscriptSegmentSnapshots,
    transcriptSaveInitialized: meeting.transcriptSaveInitialized,
    transcriptSegments: meeting.transcriptSegments ?? [],
  });
  const microphoneAttachmentPath =
    meeting.microphoneRecordingPath ??
    (input.finalizePortableMicRecording
      ? await input.finalizePortableMicRecording(input.targetMeetingId)
      : null);
  const pendingDocId = readPendingMeetingDocId(
    input.storage,
    input.workspaceId,
    input.targetMeetingId
  );
  const deterministicDocId = meetingDocumentId(input.targetMeetingId);
  const current =
    input.current?.meetingId === input.targetMeetingId ? input.current : null;
  let docId = findReusableMeetingDocId({
    backendDocId: meeting.docId,
    docExists: candidateId => workspaceDocExists(input.workspace, candidateId),
    localDocId: current?.docId,
    localDocIds: [pendingDocId, deterministicDocId],
  });
  let destination: MeetingSaveDestination = resolveMeetingSaveDestination({
    existingDocIsJournal: Boolean(
      docId && input.journalService.journalDate$(docId).value
    ),
    hasExistingDoc: Boolean(docId),
    preferred: input.recordingSavingMode,
  });
  let createdDocument = false;

  if (!docId) {
    destination = input.recordingSavingMode;
    if (destination === 'journal-today') {
      const journalDate = dayjs().format('YYYY-MM-DD');
      const existingJournal =
        input.journalService.journalsByDate$(journalDate).value[0];
      if (existingJournal) {
        docId = existingJournal.id;
      } else {
        await input.assertCanCreateWorkspaceDocument();
        docId = input.journalService.ensureJournalByDate(new Date()).id;
        createdDocument = true;
      }
    } else {
      await input.assertCanCreateWorkspaceDocument();
      docId = await ensureMeetingDoc({
        docId: deterministicDocId,
        docsService: input.docsService,
        title: meetingTitle(meeting),
        workspace: input.workspace,
      });
      createdDocument = true;
    }
  }

  if (!workspaceDocExists(input.workspace, docId)) {
    throw new Error(`Meeting note is unavailable: ${docId}`);
  }
  const targetDoc = input.workspace.getDoc(docId);
  if (!targetDoc) {
    throw new Error(`Meeting note is unavailable: ${docId}`);
  }
  targetDoc.load();
  await input.docPersistence.waitForDocLoaded(docId);
  writePendingMeetingDocId(
    input.storage,
    input.workspaceId,
    input.targetMeetingId,
    docId
  );

  let updatePermissionConfirmed = createdDocument;
  const assertCanMutateTarget = async () => {
    if (!updatePermissionConfirmed) {
      await input.assertCanUpdateWorkspaceDocument(docId);
      updatePermissionConfirmed = true;
    }
  };

  const transcriptBlockId = meetingContentBlockId(
    input.targetMeetingId,
    'transcript'
  );
  const durableBackendLink = meeting.docId === docId && !createdDocument;
  const transcriptBlockExists = workspaceDocHasBlock(
    input.workspace,
    docId,
    transcriptBlockId
  );
  let contentAdded = false;
  if (!durableBackendLink && !transcriptBlockExists) {
    await assertCanMutateTarget();
    await appendMeetingMarkdownDoc({
      blockId: transcriptBlockId,
      docId,
      markdown: meetingNoteMarkdown({
        headingLevel: destination === 'journal-today' ? 2 : 1,
        includeTitle: destination === 'journal-today',
        meeting,
        microphoneRecordingPath: microphoneAttachmentPath,
        recordingPath: current?.recordingPath ?? meeting.recordingPath,
        title: meetingTitle(meeting),
        transcriptSegments: meeting.transcriptSegments?.length
          ? finalTranscriptSegments
          : (current?.transcriptSegments ?? []),
      }),
      workspace: input.workspace,
    });
    contentAdded = true;
  }

  const recoveryTranscriptSegments = meetingTranscriptRecoverySegments({
    durableBackendLink,
    finalTranscriptSegments,
    missingTranscriptSegments,
    transcriptBlockExists,
    transcriptSaveInitialized: meeting.transcriptSaveInitialized,
  });
  const recoveryBlocks = recoveryTranscriptSegments
    .map(segment => ({
      blockId: meetingTranscriptRecoveryBlockId(input.targetMeetingId, [
        segment,
      ]),
      markdown: meetingTranscriptRecoveryMarkdown({
        headingLevel: destination === 'journal-today' ? 3 : 2,
        providerId: meeting.providerId,
        transcriptSegments: [segment],
      }),
    }))
    .filter(
      block => !workspaceDocHasBlock(input.workspace, docId, block.blockId)
    );
  if (recoveryBlocks.length) {
    await assertCanMutateTarget();
    await appendMeetingMarkdownBlocks({
      blocks: recoveryBlocks,
      docId,
      workspace: input.workspace,
    });
    contentAdded = true;
  }

  const summaryBlockId = meetingContentBlockId(
    input.targetMeetingId,
    'summary'
  );
  if (
    meeting.summary?.trim() &&
    !meeting.summaryDocIds?.includes(docId) &&
    !workspaceDocHasBlock(input.workspace, docId, summaryBlockId)
  ) {
    await assertCanMutateTarget();
    await appendMeetingMarkdownDoc({
      beforeBlockId: transcriptBlockId,
      blockId: summaryBlockId,
      docId,
      markdown: meetingSummarySectionMarkdown({
        headingLevel: destination === 'journal-today' ? 3 : 2,
        summary: meeting.summary,
      }),
      workspace: input.workspace,
    });
  }

  const attachmentPath =
    current?.recordingPath ?? meeting.recordingPath ?? null;
  const recordingBlockId = meetingContentBlockId(
    input.targetMeetingId,
    'recording'
  );
  const microphoneRecordingBlockId = meetingContentBlockId(
    input.targetMeetingId,
    'microphone-recording'
  );
  const recordingParentCandidateId = resolveMeetingRecordingParentBlockId({
    blockExists: blockId =>
      workspaceDocHasBlock(input.workspace, docId, blockId),
    meetingId: input.targetMeetingId,
  });
  const recordingAttachmentNeeded = Boolean(
    attachmentPath &&
    (!workspaceDocHasRecordingAttachment(
      input.workspace,
      docId,
      recordingBlockId,
      attachmentPath
    ) ||
      (!isRawMeetingRecording(attachmentPath) &&
        workspaceDocHasBlock(input.workspace, docId, recordingBlockId) &&
        !workspaceDocBlockHasParent(
          input.workspace,
          docId,
          recordingBlockId,
          recordingParentCandidateId
        )))
  );
  const microphoneAttachmentNeeded = Boolean(
    microphoneAttachmentPath &&
    (!workspaceDocHasRecordingAttachment(
      input.workspace,
      docId,
      microphoneRecordingBlockId,
      microphoneAttachmentPath
    ) ||
      (!isRawMeetingRecording(microphoneAttachmentPath) &&
        workspaceDocHasBlock(
          input.workspace,
          docId,
          microphoneRecordingBlockId
        ) &&
        !workspaceDocBlockHasParent(
          input.workspace,
          docId,
          microphoneRecordingBlockId,
          recordingParentCandidateId
        )))
  );
  let recordingParentBlockId: string | null = null;
  if (recordingAttachmentNeeded || microphoneAttachmentNeeded) {
    await assertCanMutateTarget();
    if (
      (recordingAttachmentNeeded &&
        attachmentPath &&
        !isRawMeetingRecording(attachmentPath)) ||
      (microphoneAttachmentNeeded &&
        microphoneAttachmentPath &&
        !isRawMeetingRecording(microphoneAttachmentPath))
    ) {
      recordingParentBlockId = await ensureMeetingRecordingParent({
        destination,
        docId,
        meetingId: input.targetMeetingId,
        workspace: input.workspace,
      });
    }
  }
  if (recordingAttachmentNeeded && attachmentPath) {
    await attachRecordingToDoc({
      blockId: recordingBlockId,
      docId,
      filepath: attachmentPath,
      parentBlockId: recordingParentBlockId,
      recordingAccess: input.recordingAccess,
      workspace: input.workspace,
    });
  }
  if (microphoneAttachmentNeeded && microphoneAttachmentPath) {
    await attachRecordingToDoc({
      blockId: microphoneRecordingBlockId,
      docId,
      filepath: microphoneAttachmentPath,
      parentBlockId: recordingParentBlockId,
      recordingAccess: input.recordingAccess,
      workspace: input.workspace,
    });
  }

  // The backend watermark must never get ahead of local canonical storage.
  // Do not wait for remote sync: saving a meeting must work offline.
  await input.docPersistence.waitForUpdated(docId);
  await input.docPersistence.waitForUpdated(input.workspace.doc.guid);

  // Keep the persisted save job until its searchable workspace mirror is
  // acknowledged. The executor is idempotent, so a transient index failure
  // safely retries without replacing user-edited transcript content.
  await syncWorkspaceContentIndex({
    accessForDocument: input.accessForWorkspaceDocument,
    documentIds: [docId],
    workspace: input.workspace,
    workspaceId: input.workspaceId,
  });

  const summaryLinkNeeded =
    Boolean(meeting.summary?.trim()) &&
    !meeting.summaryDocIds?.includes(docId) &&
    workspaceDocHasBlock(input.workspace, docId, summaryBlockId);
  const linkedMeeting = await input.patchMeeting(input.targetMeetingId, {
    docId,
    microphoneRecordingPath: microphoneAttachmentPath ?? undefined,
    recordingPath: attachmentPath ?? undefined,
    savedTranscriptSegmentIds: finalTranscriptSegments.map(
      segment => segment.id
    ),
    savedTranscriptSegmentSnapshots: transcriptSegmentSnapshots,
    summaryDocId: summaryLinkNeeded ? docId : undefined,
  });
  assertMeetingWorkspace(linkedMeeting, input.workspaceId);
  const linkedDocId = linkedMeeting.docId ?? docId;
  clearPendingMeetingDocId(
    input.storage,
    input.workspaceId,
    input.targetMeetingId
  );
  if (input.storage) {
    removePendingMeetingSaveJob({
      meetingId: input.targetMeetingId,
      storage: input.storage,
      workspaceId: input.workspaceId,
    });
  }
  return {
    contentAdded,
    destination,
    docId: linkedDocId,
    meeting: linkedMeeting,
  };
}

export function executeMeetingSaveOnce(
  input: ExecuteMeetingSaveOptions
): Promise<MeetingSaveResult> {
  const key = `${input.workspaceId}:${input.targetMeetingId}`;
  return runMeetingSaveOnce(key, () => executeMeetingSave(input));
}
