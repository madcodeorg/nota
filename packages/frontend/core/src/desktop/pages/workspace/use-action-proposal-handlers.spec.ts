/**
 * @vitest-environment happy-dom
 */
import type { StoredActionProposal } from '@nota/core/blocksuite/ai/agent';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  applyActionProposalToWorkspace: vi.fn(),
  applyPermissionForActionProposal: vi.fn(),
  applyScopedMcpActionProposal: vi.fn(),
  buildAppliedActionProposalResult: vi.fn(),
  canApplyFromChat: vi.fn(),
  claimScopedActionProposal: vi.fn(),
  claimScopedActionProposalForUndo: vi.fn(),
  getScopedActionProposal: vi.fn(),
  undoActionProposalInWorkspace: vi.fn(),
  undoInfo: vi.fn(),
  undoPermissionForActionProposal: vi.fn(),
  updateScopedActionProposal: vi.fn(),
}));

const indexMocks = vi.hoisted(() => ({
  deleteWorkspaceContentDocuments: vi.fn(),
  syncWorkspaceContentIndex: vi.fn(),
}));

const notifyMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@nota/core/blocksuite/ai/agent', () => agentMocks);
vi.mock('@nota/component', () => ({ notify: notifyMocks }));
vi.mock('./ai-workspace-index', () => indexMocks);

import { useActionProposalHandlers } from './use-action-proposal-handlers';

const scope = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
};

const undo = {
  docId: 'doc-1',
  fingerprint: 'fingerprint-1',
  type: 'trash_doc' as const,
};

function appliedProposal(): StoredActionProposal {
  return {
    createdAt: '2026-07-16T00:00:00.000Z',
    id: 'proposal-1',
    proposal: {
      markdown: '# Generated note',
      title: 'Generated note',
      type: 'create_note',
    },
    reason: null,
    result: {
      appliedAt: '2026-07-16T00:00:01.000Z',
      docId: undo.docId,
      undo,
      workspaceId: scope.workspaceId,
    },
    sessionId: scope.sessionId,
    status: 'applied',
    updatedAt: '2026-07-16T00:00:01.000Z',
    workspaceId: scope.workspaceId,
  };
}

function renderHandlers() {
  return renderHook(() =>
    useActionProposalHandlers({
      docsService: {} as never,
      isLocalWorkspace: true,
      sessionId: scope.sessionId,
      workspace: {} as never,
      workspaceId: scope.workspaceId,
    })
  );
}

beforeEach(() => {
  for (const mock of Object.values(agentMocks)) mock.mockReset();
  for (const mock of Object.values(indexMocks)) mock.mockReset();
  for (const mock of Object.values(notifyMocks)) mock.mockReset();

  const applied = appliedProposal();
  agentMocks.getScopedActionProposal.mockResolvedValue(applied);
  agentMocks.undoInfo.mockReturnValue(undo);
  agentMocks.undoPermissionForActionProposal.mockReturnValue(null);
  agentMocks.claimScopedActionProposalForUndo.mockResolvedValue({
    ...applied,
    status: 'undoing',
  });
  agentMocks.updateScopedActionProposal.mockImplementation(
    async (
      stored: StoredActionProposal,
      _activeScope: typeof scope,
      status: StoredActionProposal['status'],
      result?: Record<string, unknown>
    ) => ({ ...stored, result: result ?? stored.result, status })
  );
  indexMocks.deleteWorkspaceContentDocuments.mockResolvedValue(undefined);
  indexMocks.syncWorkspaceContentIndex.mockResolvedValue(undefined);
});

describe('useActionProposalHandlers undo claims', () => {
  test('uses the proposal card session while preserving the active workspace', async () => {
    const forkScope = { ...scope, sessionId: 'session-fork' };
    const pending = {
      ...appliedProposal(),
      result: null,
      sessionId: forkScope.sessionId,
      status: 'pending_approval' as const,
    };
    agentMocks.getScopedActionProposal.mockResolvedValue(pending);
    const { result } = renderHandlers();

    await act(async () => {
      await result.current.rejectActionProposal(pending, forkScope);
    });

    expect(agentMocks.getScopedActionProposal).toHaveBeenCalledWith(
      pending,
      forkScope
    );
    expect(agentMocks.updateScopedActionProposal).toHaveBeenCalledWith(
      pending,
      forkScope,
      'rejected'
    );
  });

  test('claims the durable backend transition before destructive local undo', async () => {
    const order: string[] = [];
    const applied = appliedProposal();
    agentMocks.claimScopedActionProposalForUndo.mockImplementation(async () => {
      order.push('claim');
      return { ...applied, status: 'undoing' };
    });
    agentMocks.undoActionProposalInWorkspace.mockImplementation(() => {
      order.push('local-undo');
    });
    agentMocks.updateScopedActionProposal.mockImplementation(
      async (stored: StoredActionProposal, _activeScope, status) => {
        order.push(`status:${status}`);
        return { ...stored, status };
      }
    );
    const { result } = renderHandlers();

    let updated: StoredActionProposal | undefined;
    await act(async () => {
      updated = await result.current.undoActionProposal(applied);
    });

    expect(order).toEqual(['claim', 'local-undo', 'status:undone']);
    expect(updated?.status).toBe('undone');
    expect(notifyMocks.success).toHaveBeenCalledWith({
      title: 'Nota AI action undone',
    });
  });

  test('returns the claim to applied when local undo refuses the mutation', async () => {
    const order: string[] = [];
    const applied = appliedProposal();
    agentMocks.claimScopedActionProposalForUndo.mockImplementation(async () => {
      order.push('claim');
      return { ...applied, status: 'undoing' };
    });
    agentMocks.undoActionProposalInWorkspace.mockImplementation(() => {
      order.push('local-undo');
      throw new Error('The note changed after the AI action.');
    });
    agentMocks.updateScopedActionProposal.mockImplementation(
      async (stored: StoredActionProposal, _activeScope, status) => {
        order.push(`status:${status}`);
        return { ...stored, status };
      }
    );
    const { result } = renderHandlers();

    let updated: StoredActionProposal | undefined;
    await act(async () => {
      updated = await result.current.undoActionProposal(applied);
    });

    expect(updated).toBeUndefined();
    expect(order).toEqual(['claim', 'local-undo', 'status:applied']);
    expect(notifyMocks.error).toHaveBeenCalledWith({
      message: 'The note changed after the AI action.',
      title: 'Failed to undo AI action',
    });
  });
});
