import {
  assertActionProposalWorkspace,
  type StoredActionProposal,
} from './action-proposals';

export type ActionProposalClientStatus = Extract<
  StoredActionProposal['status'],
  'applied' | 'approved' | 'failed' | 'rejected' | 'undone'
>;

export type ActionProposalScope = {
  sessionId: string;
  workspaceId: string;
};

export function actionProposalScope(
  stored: StoredActionProposal,
  activeScope: ActionProposalScope
): ActionProposalScope {
  assertActionProposalWorkspace(stored, activeScope.workspaceId);
  if (!stored.sessionId) {
    throw new Error(
      'This AI action is missing its originating chat session and cannot be changed safely.'
    );
  }
  if (stored.sessionId !== activeScope.sessionId) {
    throw new Error(
      'This AI action belongs to a different chat session and cannot be changed here.'
    );
  }
  return activeScope;
}

export function scopedActionProposalUrl(
  proposalId: string,
  scope: ActionProposalScope
) {
  const query = new URLSearchParams(scope);
  return `/v1/agent/actions/proposals/${encodeURIComponent(proposalId)}?${query.toString()}`;
}

async function readProposalResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    proposal?: StoredActionProposal;
  } | null;
  if (!response.ok) {
    throw new Error(
      body?.error || `Action proposal request failed: ${response.status}`
    );
  }
  if (!body?.proposal) {
    throw new Error('Action proposal response did not include a proposal.');
  }
  return body.proposal;
}

export async function getScopedActionProposal(
  stored: StoredActionProposal,
  activeScope: ActionProposalScope
) {
  const scope = actionProposalScope(stored, activeScope);
  const proposal = await readProposalResponse(
    await fetch(scopedActionProposalUrl(stored.id, scope))
  );
  assertActionProposalWorkspace(proposal, activeScope.workspaceId);
  if (proposal.sessionId !== scope.sessionId) {
    throw new Error('The AI action returned from a different chat session.');
  }
  return proposal;
}

export async function updateScopedActionProposal(
  stored: StoredActionProposal,
  activeScope: ActionProposalScope,
  status: ActionProposalClientStatus,
  result?: Record<string, unknown>
) {
  const scope = actionProposalScope(stored, activeScope);
  const proposal = await readProposalResponse(
    await fetch(scopedActionProposalUrl(stored.id, scope), {
      body: JSON.stringify({ ...scope, result, status }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
  );
  assertActionProposalWorkspace(proposal, activeScope.workspaceId);
  if (proposal.sessionId !== scope.sessionId) {
    throw new Error('The AI action returned from a different chat session.');
  }
  return proposal;
}

export async function applyScopedMcpActionProposal(
  stored: StoredActionProposal,
  activeScope: ActionProposalScope
) {
  const scope = actionProposalScope(stored, activeScope);
  const proposal = await readProposalResponse(
    await fetch(
      `/v1/agent/actions/proposals/${encodeURIComponent(stored.id)}/apply`,
      {
        body: JSON.stringify(scope),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    )
  );
  assertActionProposalWorkspace(proposal, activeScope.workspaceId);
  if (proposal.sessionId !== scope.sessionId) {
    throw new Error('The AI action returned from a different chat session.');
  }
  return proposal;
}

export async function claimScopedActionProposal(
  stored: StoredActionProposal,
  activeScope: ActionProposalScope
) {
  const scope = actionProposalScope(stored, activeScope);
  const proposal = await readProposalResponse(
    await fetch(
      `/v1/agent/actions/proposals/${encodeURIComponent(stored.id)}/claim`,
      {
        body: JSON.stringify(scope),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    )
  );
  assertActionProposalWorkspace(proposal, activeScope.workspaceId);
  if (proposal.sessionId !== scope.sessionId) {
    throw new Error('The AI action returned from a different chat session.');
  }
  return proposal;
}

export async function claimScopedActionProposalForUndo(
  stored: StoredActionProposal,
  activeScope: ActionProposalScope
) {
  const scope = actionProposalScope(stored, activeScope);
  const proposal = await readProposalResponse(
    await fetch(
      `/v1/agent/actions/proposals/${encodeURIComponent(stored.id)}/undo-claim`,
      {
        body: JSON.stringify(scope),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    )
  );
  assertActionProposalWorkspace(proposal, activeScope.workspaceId);
  if (proposal.sessionId !== scope.sessionId) {
    throw new Error('The AI action returned from a different chat session.');
  }
  return proposal;
}
