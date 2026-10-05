import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  actionProposalScope,
  applyScopedMcpActionProposal,
  claimScopedActionProposal,
  claimScopedActionProposalForUndo,
  getScopedActionProposal,
  scopedActionProposalUrl,
  updateScopedActionProposal,
} from '../action-proposal-client.js';
import type { StoredActionProposal } from '../action-proposals.js';

const activeScope = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
};

function stored(
  overrides: Partial<StoredActionProposal> = {}
): StoredActionProposal {
  return {
    createdAt: '2026-07-16T00:00:00.000Z',
    id: 'proposal/1',
    proposal: {
      markdown: '# Safe edit',
      title: 'Safe edit',
      type: 'create_note',
    },
    reason: null,
    result: null,
    sessionId: activeScope.sessionId,
    status: 'pending_approval',
    updatedAt: '2026-07-16T00:00:00.000Z',
    workspaceId: activeScope.workspaceId,
    ...overrides,
  };
}

function proposalResponse(proposal: StoredActionProposal) {
  return new Response(JSON.stringify({ proposal }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scoped action proposal client', () => {
  test('requires the active workspace and originating session', () => {
    expect(actionProposalScope(stored(), activeScope)).toEqual(activeScope);
    expect(() =>
      actionProposalScope(stored(), {
        ...activeScope,
        workspaceId: 'workspace-2',
      })
    ).toThrow('different workspace');
    expect(() =>
      actionProposalScope(stored(), {
        ...activeScope,
        sessionId: 'session-2',
      })
    ).toThrow('different chat session');
    expect(() =>
      actionProposalScope(stored({ sessionId: null }), activeScope)
    ).toThrow('missing its originating chat session');
  });

  test('gets a proposal with encoded id and explicit scope', async () => {
    const proposal = stored();
    const fetch = vi.fn(async () => proposalResponse(proposal));
    vi.stubGlobal('fetch', fetch);

    await expect(
      getScopedActionProposal(proposal, activeScope)
    ).resolves.toEqual(proposal);
    expect(fetch).toHaveBeenCalledWith(
      '/v1/agent/actions/proposals/proposal%2F1?sessionId=session-1&workspaceId=workspace-1'
    );
    expect(scopedActionProposalUrl(proposal.id, activeScope)).toContain(
      'workspaceId=workspace-1'
    );
  });

  test('sends scope on status updates and local apply and undo claims', async () => {
    const approved = stored({ status: 'approved' });
    const applying = stored({ status: 'applying' });
    const applied = stored({
      result: {
        undo: {
          docId: 'doc-1',
          fingerprint: 'fingerprint',
          type: 'trash_doc',
        },
      },
      status: 'applied',
    });
    const undoing = stored({ ...applied, status: 'undoing' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(proposalResponse(approved))
      .mockResolvedValueOnce(proposalResponse(applying))
      .mockResolvedValueOnce(proposalResponse(undoing));
    vi.stubGlobal('fetch', fetch);

    await updateScopedActionProposal(stored(), activeScope, 'approved');
    await claimScopedActionProposal(approved, activeScope);
    await claimScopedActionProposalForUndo(applied, activeScope);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('?sessionId=session-1&workspaceId=workspace-1'),
      expect.objectContaining({
        body: JSON.stringify({ ...activeScope, status: 'approved' }),
        method: 'PATCH',
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/v1/agent/actions/proposals/proposal%2F1/claim',
      expect.objectContaining({
        body: JSON.stringify(activeScope),
        method: 'POST',
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/v1/agent/actions/proposals/proposal%2F1/undo-claim',
      expect.objectContaining({
        body: JSON.stringify(activeScope),
        method: 'POST',
      })
    );
  });

  test('uses the scoped backend apply endpoint only for MCP actions', async () => {
    const proposal = stored({
      proposal: {
        args: { query: 'Nota' },
        toolName: 'search',
        type: 'run_mcp_tool',
      },
      status: 'approved',
    });
    const applied = { ...proposal, status: 'applied' as const };
    const fetch = vi.fn(async () => proposalResponse(applied));
    vi.stubGlobal('fetch', fetch);

    await expect(
      applyScopedMcpActionProposal(proposal, activeScope)
    ).resolves.toEqual(applied);
    expect(fetch).toHaveBeenCalledWith(
      '/v1/agent/actions/proposals/proposal%2F1/apply',
      expect.objectContaining({
        body: JSON.stringify(activeScope),
        method: 'POST',
      })
    );
  });

  test('rejects a response that crosses the active session boundary', async () => {
    const proposal = stored();
    const fetch = vi.fn(async () =>
      proposalResponse(stored({ sessionId: 'session-2' }))
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      getScopedActionProposal(proposal, activeScope)
    ).rejects.toThrow('different chat session');
  });
});
