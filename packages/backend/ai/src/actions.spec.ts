import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTION_PROPOSAL_APPLY_STALE_MS,
  ACTION_PROPOSAL_UNDO_STALE_MS,
  claimActionProposalForApply,
  claimActionProposalForUndo,
  configureActionProposalStore,
  createActionProposal,
  getActionProposal,
  listActionProposals,
  readActionProposal,
  recoverStaleApplyingActionProposals,
  recoverStaleUndoingActionProposals,
  updateActionProposalStatus,
} from './actions.js';
import type { AiBackendConfig } from './config.js';
import { createNotaToolContext } from './tools.js';

const alphaScope = {
  sessionId: 'session-alpha',
  workspaceId: 'workspace-alpha',
};
const betaScope = {
  sessionId: 'session-beta',
  workspaceId: 'workspace-beta',
};

let temporaryRoot = '';
let proposalStorePath = '';

beforeEach(async () => {
  temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nota-action-proposals-')
  );
  proposalStorePath = path.join(temporaryRoot, 'agent-action-proposals.json');
  configureActionProposalStore(proposalStorePath);
});

afterEach(async () => {
  await rm(temporaryRoot, { force: true, recursive: true });
});

function createAlphaProposal() {
  return createActionProposal({
    proposal: {
      args: { title: 'Trusted action' },
      toolName: 'mcp_notes_create_note',
      type: 'run_mcp_tool',
    },
    reason: 'The user asked to create a note.',
    ...alphaScope,
  });
}

describe('action proposal scope and transitions', () => {
  it('persists proposal content in an owner-only local file', async () => {
    createAlphaProposal();

    const metadata = await stat(proposalStorePath);
    expect(metadata.mode & 0o777).toBe(0o600);
  });

  it('never exposes or mutates a proposal outside its exact trusted scope', () => {
    const proposal = createAlphaProposal();

    expect(getActionProposal(proposal.id, alphaScope)?.id).toBe(proposal.id);
    expect(getActionProposal(proposal.id, betaScope)).toBeNull();
    expect(listActionProposals(betaScope)).toEqual([]);
    expect(
      updateActionProposalStatus(proposal.id, betaScope, 'approved')
    ).toBeNull();
    expect(getActionProposal(proposal.id, alphaScope)?.status).toBe(
      'pending_approval'
    );
  });

  it('requires approval, atomically claims apply, and supports explicit retry', () => {
    const proposal = createAlphaProposal();

    expect(() =>
      updateActionProposalStatus(proposal.id, alphaScope, 'applied')
    ).toThrow(/pending_approval to applied/);
    expect(() => claimActionProposalForApply(proposal.id, alphaScope)).toThrow(
      /pending_approval/
    );

    updateActionProposalStatus(proposal.id, alphaScope, 'approved');
    expect(claimActionProposalForApply(proposal.id, alphaScope)?.status).toBe(
      'applying'
    );
    expect(() => claimActionProposalForApply(proposal.id, alphaScope)).toThrow(
      /applying/
    );

    updateActionProposalStatus(proposal.id, alphaScope, 'failed', {
      error: 'temporary failure',
    });
    expect(() => claimActionProposalForApply(proposal.id, alphaScope)).toThrow(
      /failed/
    );

    updateActionProposalStatus(proposal.id, alphaScope, 'approved');
    claimActionProposalForApply(proposal.id, alphaScope);
    updateActionProposalStatus(proposal.id, alphaScope, 'applied', {
      appliedAt: 'now',
    });
    expect(() =>
      updateActionProposalStatus(proposal.id, alphaScope, 'undone')
    ).toThrow(/applied to undone/);
    expect(claimActionProposalForUndo(proposal.id, alphaScope)?.status).toBe(
      'undoing'
    );
    expect(() => claimActionProposalForUndo(proposal.id, alphaScope)).toThrow(
      /undoing/
    );
    expect(
      updateActionProposalStatus(proposal.id, alphaScope, 'undone')?.status
    ).toBe('undone');
    expect(() =>
      updateActionProposalStatus(proposal.id, alphaScope, 'approved')
    ).toThrow(/undone to approved/);
  });

  it('recovers an interrupted apply as failed without automatically retrying', () => {
    const proposal = createAlphaProposal();
    updateActionProposalStatus(proposal.id, alphaScope, 'approved');
    claimActionProposalForApply(proposal.id, alphaScope);

    configureActionProposalStore(proposalStorePath);

    const recovered = getActionProposal(proposal.id, alphaScope);
    expect(recovered?.status).toBe('failed');
    expect(recovered?.result?.error).toMatch(/interrupted before completion/);
    expect(recovered?.result?.retryable).toBe(false);
    expect(recovered?.result?.reviewRequired).toBe(true);
    expect(() => claimActionProposalForApply(proposal.id, alphaScope)).toThrow(
      /failed/
    );
  });

  it('recovers a stale in-process apply as review-required without a restart', () => {
    const proposal = createAlphaProposal();
    updateActionProposalStatus(proposal.id, alphaScope, 'approved');
    const applying = claimActionProposalForApply(proposal.id, alphaScope);
    const staleAt =
      Date.parse(applying?.updatedAt ?? '') +
      ACTION_PROPOSAL_APPLY_STALE_MS +
      1;

    expect(recoverStaleApplyingActionProposals(staleAt)).toBe(true);
    const recovered = getActionProposal(proposal.id, alphaScope);
    expect(recovered?.status).toBe('failed');
    expect(recovered?.result).toMatchObject({
      retryable: false,
      reviewRequired: true,
    });
  });

  it('atomically claims undo and lets a failed local undo return to applied', () => {
    const proposal = createAlphaProposal();
    updateActionProposalStatus(proposal.id, alphaScope, 'approved');
    claimActionProposalForApply(proposal.id, alphaScope);
    const applied = updateActionProposalStatus(
      proposal.id,
      alphaScope,
      'applied',
      {
        appliedAt: 'now',
        undo: { docId: 'doc-1', fingerprint: 'fingerprint', type: 'trash_doc' },
      }
    );

    const undoing = claimActionProposalForUndo(proposal.id, alphaScope);
    expect(undoing?.status).toBe('undoing');
    expect(undoing?.result).toEqual(applied?.result);
    expect(() => claimActionProposalForUndo(proposal.id, alphaScope)).toThrow(
      /undoing/
    );

    const restored = updateActionProposalStatus(
      proposal.id,
      alphaScope,
      'applied'
    );
    expect(restored?.status).toBe('applied');
    expect(restored?.result).toEqual(applied?.result);

    claimActionProposalForUndo(proposal.id, alphaScope);
    expect(
      updateActionProposalStatus(proposal.id, alphaScope, 'undone')?.status
    ).toBe('undone');
  });

  it('recovers stale and restarted undo claims conservatively to applied', () => {
    const proposal = createAlphaProposal();
    updateActionProposalStatus(proposal.id, alphaScope, 'approved');
    claimActionProposalForApply(proposal.id, alphaScope);
    updateActionProposalStatus(proposal.id, alphaScope, 'applied', {
      undo: { docId: 'doc-1', fingerprint: 'fingerprint', type: 'trash_doc' },
    });
    const undoing = claimActionProposalForUndo(proposal.id, alphaScope);
    const staleAt =
      Date.parse(undoing?.updatedAt ?? '') + ACTION_PROPOSAL_UNDO_STALE_MS + 1;

    expect(recoverStaleUndoingActionProposals(staleAt)).toBe(true);
    expect(getActionProposal(proposal.id, alphaScope)?.status).toBe('applied');

    claimActionProposalForUndo(proposal.id, alphaScope);
    configureActionProposalStore(proposalStorePath);
    const recoveredAfterRestart = getActionProposal(proposal.id, alphaScope);
    expect(recoveredAfterRestart?.status).toBe('applied');
    expect(recoveredAfterRestart?.result?.undo).toEqual({
      docId: 'doc-1',
      fingerprint: 'fingerprint',
      type: 'trash_doc',
    });
  });

  it('rejects creating whole-document clears until a safe undo exists', () => {
    expect(() =>
      createActionProposal({
        ...alphaScope,
        proposal: readActionProposal({ docId: 'doc-1', type: 'clear_doc' }),
      })
    ).toThrow(/disabled until Nota can restore it safely/);
  });
});

describe('propose_nota_action tool scope', () => {
  it('ignores a model-supplied workspace id and uses the trusted session scope', async () => {
    const config = {
      mcpConfig: '{}',
      mcpEnabled: false,
      toolsEnabled: true,
      workspaceSearchToolEnabled: false,
    } as AiBackendConfig;
    const context = await createNotaToolContext(config, alphaScope);

    try {
      const proposalTool = context.tools?.propose_nota_action as
        | {
            execute?: (
              input: Record<string, unknown>,
              options: { messages: []; toolCallId: string }
            ) => unknown;
          }
        | undefined;
      expect(proposalTool?.execute).toBeTypeOf('function');

      const result = (await proposalTool?.execute?.(
        {
          proposal: {
            markdown: '# Trusted workspace',
            title: 'Trusted workspace',
            type: 'create_note',
          },
          reason: 'Create a note.',
          workspaceId: betaScope.workspaceId,
        },
        { messages: [], toolCallId: 'proposal-scope-test' }
      )) as { proposal: { id: string; workspaceId: string | null } };

      expect(result.proposal.workspaceId).toBe(alphaScope.workspaceId);
      expect(getActionProposal(result.proposal.id, alphaScope)?.id).toBe(
        result.proposal.id
      );
      expect(getActionProposal(result.proposal.id, betaScope)).toBeNull();
    } finally {
      await context.close();
    }
  });

  it('refuses to create a proposal without a trusted chat session', async () => {
    const config = {
      mcpConfig: '{}',
      mcpEnabled: false,
      toolsEnabled: true,
      workspaceSearchToolEnabled: false,
    } as AiBackendConfig;
    const context = await createNotaToolContext(config, {
      workspaceId: alphaScope.workspaceId,
    });

    try {
      const proposalTool = context.tools?.propose_nota_action as
        | {
            execute?: (
              input: Record<string, unknown>,
              options: { messages: []; toolCallId: string }
            ) => unknown;
          }
        | undefined;
      await expect(
        proposalTool?.execute?.(
          {
            proposal: {
              markdown: '# Missing session',
              title: 'Missing session',
              type: 'create_note',
            },
          },
          { messages: [], toolCallId: 'missing-session-test' }
        )
      ).rejects.toThrow(/trusted Nota workspace and chat session/);
    } finally {
      await context.close();
    }
  });
});
