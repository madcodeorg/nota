import type { ServiceProvider } from '@blocksuite/affine/global/di';
import type { Workspace } from '@blocksuite/affine/store';
import { notify } from '@nota/component';
import {
  type ActionProposalScope,
  type AgentActionProposal,
  applyActionProposalToWorkspace,
  applyPermissionForActionProposal,
  applyScopedMcpActionProposal,
  buildAppliedActionProposalResult,
  canApplyFromChat,
  claimScopedActionProposal,
  claimScopedActionProposalForUndo,
  getScopedActionProposal,
  type StoredActionProposal,
  undoActionProposalInWorkspace,
  undoInfo,
  undoPermissionForActionProposal,
  updateScopedActionProposal,
} from '@nota/core/blocksuite/ai/agent';
import type { AffineEditorContainer } from '@nota/core/blocksuite/block-suite-editor';
import type { DocsService } from '@nota/core/modules/doc';
import type { GuardService } from '@nota/core/modules/permissions';
import { useCallback, useState } from 'react';

import {
  deleteWorkspaceContentDocuments,
  syncWorkspaceContentIndex,
} from './ai-workspace-index';

type WorkspaceAccessForDocument = NonNullable<
  Parameters<typeof syncWorkspaceContentIndex>[0]['accessForDocument']
>;

type SelectionProposal = Extract<
  AgentActionProposal,
  { type: 'insert_markdown' | 'replace_selection' }
>;

const applyingProposalIds = new Set<string>();

export interface ActionProposalHandlersOptions {
  accessForDocument?: WorkspaceAccessForDocument;
  docsService: DocsService;
  getSelectionEditorContainer?: (
    proposal: SelectionProposal
  ) => AffineEditorContainer | null;
  guardService?: GuardService | null;
  isLocalWorkspace: boolean;
  mindmapProvider?: ServiceProvider | null;
  onOpenDoc?: (docId: string) => void;
  sessionId?: string | null;
  workspace: Workspace;
  workspaceId: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function assertActionPermission(
  guardService: GuardService | null | undefined,
  permission: ReturnType<typeof applyPermissionForActionProposal>,
  isLocalWorkspace: boolean
) {
  if (!permission || isLocalWorkspace) {
    return;
  }
  if (!guardService) {
    throw new Error(
      'Nota could not verify permission for this workspace. Reconnect and try again.'
    );
  }

  let allowed = false;
  try {
    allowed =
      'docId' in permission
        ? await guardService.can(permission.action, permission.docId)
        : await guardService.can(permission.action);
  } catch {
    throw new Error(
      'Nota could not verify permission for the target note. Try again after the workspace reconnects.'
    );
  }
  if (!allowed) {
    throw new Error('You do not have permission to make this workspace edit.');
  }
}

async function refreshWorkspaceIndexAfterUndo(options: {
  accessForDocument: WorkspaceAccessForDocument;
  undo: NonNullable<ReturnType<typeof undoInfo>>;
  workspace: Workspace;
  workspaceId: string;
}) {
  if (options.undo.type === 'trash_doc') {
    await deleteWorkspaceContentDocuments({
      docIds: [options.undo.docId],
      workspaceId: options.workspaceId,
    });
    return;
  }

  await syncWorkspaceContentIndex({
    accessForDocument: options.accessForDocument,
    documentIds: [options.undo.docId],
    workspace: options.workspace,
    workspaceId: options.workspaceId,
  });
}

export function useActionProposalHandlers({
  accessForDocument,
  docsService,
  getSelectionEditorContainer,
  guardService,
  isLocalWorkspace,
  mindmapProvider,
  onOpenDoc,
  sessionId,
  workspace,
  workspaceId,
}: ActionProposalHandlersOptions) {
  const [applyingProposalId, setApplyingProposalId] = useState<string | null>(
    null
  );

  const indexAccessForDocument = useCallback<WorkspaceAccessForDocument>(
    async options => {
      if (accessForDocument) {
        return accessForDocument(options);
      }
      if (isLocalWorkspace) {
        return { readable: true, visibility: 'workspace' };
      }
      if (!guardService) {
        return { readable: false, visibility: 'workspace' };
      }
      try {
        return {
          readable: await guardService.can('Doc_Read', options.docId),
          visibility: 'workspace',
        };
      } catch {
        return { readable: false, visibility: 'workspace' };
      }
    },
    [accessForDocument, guardService, isLocalWorkspace]
  );

  const scope = useCallback(
    (activeScope?: ActionProposalScope | null) => {
      if (activeScope && activeScope.workspaceId !== workspaceId) {
        throw new Error(
          'This AI action belongs to a different workspace and cannot be changed here.'
        );
      }
      const activeSessionId = activeScope?.sessionId ?? sessionId;
      if (!activeSessionId) {
        throw new Error(
          'This AI action is missing its active chat session. Reopen the original chat and try again.'
        );
      }
      return { sessionId: activeSessionId, workspaceId };
    },
    [sessionId, workspaceId]
  );

  const begin = useCallback((proposalId: string) => {
    if (applyingProposalIds.size) {
      return false;
    }
    applyingProposalIds.add(proposalId);
    setApplyingProposalId(proposalId);
    return true;
  }, []);

  const end = useCallback((proposalId: string) => {
    applyingProposalIds.delete(proposalId);
    setApplyingProposalId(current => (current === proposalId ? null : current));
  }, []);

  const applyActionProposal = useCallback(
    async (
      initial: StoredActionProposal,
      actionScope?: ActionProposalScope | null
    ) => {
      if (!begin(initial.id)) {
        return undefined;
      }

      try {
        const activeScope = scope(actionScope);
        const stored = await getScopedActionProposal(initial, activeScope);
        const { proposal } = stored;
        const needsSelectionEditor =
          proposal.type === 'replace_selection' ||
          (proposal.type === 'insert_markdown' &&
            proposal.position === 'selection');
        const replaceEditorContainer = needsSelectionEditor
          ? (getSelectionEditorContainer?.(proposal) ?? null)
          : null;

        if (!canApplyFromChat(stored, replaceEditorContainer)) {
          if (proposal.type === 'clear_doc') {
            throw new Error(
              'Clearing an entire note is disabled until Nota can restore it safely.'
            );
          }
          if (needsSelectionEditor && !replaceEditorContainer) {
            throw new Error(
              'Open the target note and select text or blocks before applying this action.'
            );
          }
          throw new Error(
            stored.status === 'failed' && stored.result?.retryable !== true
              ? 'This action may have changed the note before it failed and cannot be retried safely.'
              : `This action cannot be applied from status ${stored.status.replace(/_/g, ' ')}.`
          );
        }

        await assertActionPermission(
          guardService,
          applyPermissionForActionProposal(proposal),
          isLocalWorkspace
        );

        const approved =
          stored.status === 'approved'
            ? stored
            : await updateScopedActionProposal(stored, activeScope, 'approved');
        if (proposal.type === 'run_mcp_tool') {
          const applied = await applyScopedMcpActionProposal(
            approved,
            activeScope
          );
          notify.success({ title: 'MCP tool action applied' });
          return applied;
        }

        const claimed = await claimScopedActionProposal(approved, activeScope);
        let mutation: Awaited<
          ReturnType<typeof applyActionProposalToWorkspace>
        >;
        try {
          mutation = await applyActionProposalToWorkspace({
            docsService,
            mindmapProvider,
            proposal,
            replaceEditorContainer,
            workspace,
          });
        } catch (mutationError) {
          await updateScopedActionProposal(claimed, activeScope, 'failed', {
            error: errorMessage(mutationError),
            failedAt: new Date().toISOString(),
            retryable: false,
            reviewRequired: true,
            type: proposal.type,
            workspaceId,
          });
          throw mutationError;
        }

        const result = buildAppliedActionProposalResult({
          mutation,
          proposal,
          workspaceId,
        });
        let applied: StoredActionProposal;
        try {
          applied = await updateScopedActionProposal(
            claimed,
            activeScope,
            'applied',
            result
          );
        } catch (statusError) {
          const refreshed = await getScopedActionProposal(claimed, activeScope);
          if (refreshed.status === 'applied') {
            applied = refreshed;
          } else {
            await updateScopedActionProposal(refreshed, activeScope, 'failed', {
              ...result,
              error:
                'The note changed, but Nota could not confirm the action status. Review the note before taking another action.',
              failedAt: new Date().toISOString(),
              retryable: false,
              reviewRequired: true,
            });
            throw statusError;
          }
        }

        await syncWorkspaceContentIndex({
          accessForDocument: indexAccessForDocument,
          documentIds: [mutation.docId],
          workspace,
          workspaceId,
        }).catch(console.error);
        notify.success({ title: 'Nota AI action applied' });
        onOpenDoc?.(mutation.docId);
        return applied;
      } catch (error) {
        notify.error({
          title: 'Failed to apply AI action',
          message: errorMessage(error),
        });
        return undefined;
      } finally {
        end(initial.id);
      }
    },
    [
      begin,
      docsService,
      end,
      getSelectionEditorContainer,
      guardService,
      indexAccessForDocument,
      isLocalWorkspace,
      mindmapProvider,
      onOpenDoc,
      scope,
      workspace,
      workspaceId,
    ]
  );

  const rejectActionProposal = useCallback(
    async (
      initial: StoredActionProposal,
      actionScope?: ActionProposalScope | null
    ) => {
      if (!begin(initial.id)) {
        return undefined;
      }
      try {
        const activeScope = scope(actionScope);
        const stored = await getScopedActionProposal(initial, activeScope);
        if (
          stored.status !== 'pending_approval' &&
          stored.status !== 'approved' &&
          stored.status !== 'failed'
        ) {
          throw new Error(
            `This action cannot be rejected from status ${stored.status.replace(/_/g, ' ')}.`
          );
        }
        return await updateScopedActionProposal(
          stored,
          activeScope,
          'rejected'
        );
      } catch (error) {
        notify.error({
          title: 'Failed to reject AI action',
          message: errorMessage(error),
        });
        return undefined;
      } finally {
        end(initial.id);
      }
    },
    [begin, end, scope]
  );

  const undoActionProposal = useCallback(
    async (
      initial: StoredActionProposal,
      actionScope?: ActionProposalScope | null
    ) => {
      if (!begin(initial.id)) {
        return undefined;
      }
      try {
        const activeScope = scope(actionScope);
        const stored = await getScopedActionProposal(initial, activeScope);
        const undo = undoInfo(stored);
        if (stored.status !== 'applied' || !undo) {
          throw new Error(
            'This action does not have document, editor-history, block, or surface undo information.'
          );
        }
        await assertActionPermission(
          guardService,
          undoPermissionForActionProposal(undo),
          isLocalWorkspace
        );
        const claimed = await claimScopedActionProposalForUndo(
          stored,
          activeScope
        );
        try {
          undoActionProposalInWorkspace({ docsService, undo, workspace });
        } catch (mutationError) {
          try {
            await updateScopedActionProposal(claimed, activeScope, 'applied');
          } catch (releaseError) {
            const refreshed = await getScopedActionProposal(
              claimed,
              activeScope
            ).catch(() => null);
            if (refreshed?.status !== 'applied') {
              throw new Error(
                `The undo did not complete, and Nota could not release its undo claim. Refresh before trying again. ${errorMessage(
                  mutationError
                )} ${errorMessage(releaseError)}`
              );
            }
          }
          throw mutationError;
        }

        let undone: StoredActionProposal;
        try {
          undone = await updateScopedActionProposal(
            claimed,
            activeScope,
            'undone',
            {
              ...stored.result,
              undoneAt: new Date().toISOString(),
              workspaceId,
            }
          );
        } catch (statusError) {
          const refreshed = await getScopedActionProposal(claimed, activeScope);
          if (refreshed.status !== 'undone') {
            throw new Error(
              `The note was restored, but Nota could not save the undo status. Refresh before trying again. ${errorMessage(statusError)}`
            );
          }
          undone = refreshed;
        }

        await refreshWorkspaceIndexAfterUndo({
          accessForDocument: indexAccessForDocument,
          undo,
          workspace,
          workspaceId,
        }).catch(console.error);
        notify.success({ title: 'Nota AI action undone' });
        return undone;
      } catch (error) {
        notify.error({
          title: 'Failed to undo AI action',
          message: errorMessage(error),
        });
        return undefined;
      } finally {
        end(initial.id);
      }
    },
    [
      begin,
      docsService,
      end,
      guardService,
      indexAccessForDocument,
      isLocalWorkspace,
      scope,
      workspace,
      workspaceId,
    ]
  );

  return {
    applyingProposalId,
    applyActionProposal,
    rejectActionProposal,
    undoActionProposal,
  };
}
