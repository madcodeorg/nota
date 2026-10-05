import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export type AgentActionProposal =
  | {
      markdown: string;
      title: string;
      type: 'create_note';
    }
  | {
      docId: string;
      markdown: string;
      position?: 'end' | 'selection' | 'start';
      type: 'insert_markdown';
    }
  | {
      docId: string;
      markdown: string;
      type: 'replace_selection';
    }
  | {
      docId: string;
      markdown: string;
      type: 'create_mindmap';
    }
  | {
      docId?: string;
      markdown: string;
      title: string;
      type: 'create_task_list';
    }
  | {
      markdown: string;
      title: string;
      type: 'create_database';
    }
  | {
      databaseBlockId?: string;
      docId: string;
      markdown: string;
      type: 'append_database_rows';
    }
  | {
      docId: string;
      type: 'clear_doc';
    }
  | {
      args?: unknown;
      toolName: string;
      type: 'run_mcp_tool';
    };

export interface StoredActionProposal {
  createdAt: string;
  id: string;
  proposal: AgentActionProposal;
  reason: string | null;
  result: Record<string, unknown> | null;
  sessionId: string | null;
  status:
    | 'pending_approval'
    | 'approved'
    | 'applying'
    | 'undoing'
    | 'failed'
    | 'rejected'
    | 'applied'
    | 'undone';
  updatedAt: string;
  workspaceId: string | null;
}

export interface ActionProposalScope {
  sessionId: string;
  workspaceId: string;
}

const proposals = new Map<string, StoredActionProposal>();
const MAX_STORED_PROPOSALS = 500;
const STORE_VERSION = 1;
export const ACTION_PROPOSAL_APPLY_STALE_MS = 5 * 60 * 1000;
export const ACTION_PROPOSAL_UNDO_STALE_MS = 5 * 60 * 1000;
let storePath: string | null = null;

function parseStoredActionProposal(
  value: unknown
): StoredActionProposal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id ? record.id : null;
  const createdAt =
    typeof record.createdAt === 'string' && record.createdAt
      ? record.createdAt
      : null;
  const updatedAt =
    typeof record.updatedAt === 'string' && record.updatedAt
      ? record.updatedAt
      : createdAt;
  const status = record.status;
  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    (status !== 'pending_approval' &&
      status !== 'approved' &&
      status !== 'applying' &&
      status !== 'undoing' &&
      status !== 'failed' &&
      status !== 'rejected' &&
      status !== 'applied' &&
      status !== 'undone')
  ) {
    return null;
  }

  try {
    return {
      createdAt,
      id,
      proposal: readActionProposal(record.proposal),
      reason: typeof record.reason === 'string' ? record.reason : null,
      result:
        record.result && typeof record.result === 'object'
          ? (record.result as Record<string, unknown>)
          : null,
      sessionId:
        typeof record.sessionId === 'string' && record.sessionId
          ? record.sessionId
          : null,
      status,
      updatedAt,
      workspaceId:
        typeof record.workspaceId === 'string' ? record.workspaceId : null,
    };
  } catch {
    return null;
  }
}

function trimStoredProposals() {
  const ordered = [...proposals.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  for (const proposal of ordered.slice(MAX_STORED_PROPOSALS)) {
    proposals.delete(proposal.id);
  }
}

function persistActionProposals() {
  if (!storePath) return;

  trimStoredProposals();
  const payload = {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    proposals: [...proposals.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
  };
  mkdirSync(path.dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), {
    mode: 0o600,
  });
  renameSync(temporaryPath, storePath);
}

function interruptedApplyResult(
  proposal: StoredActionProposal,
  failedAt: string
) {
  return {
    ...proposal.result,
    error:
      'Action application was interrupted before completion. Review the target before deciding what to do next.',
    failedAt,
    retryable: false,
    reviewRequired: true,
  };
}

function recoverStaleActionProposalClaims(now: number) {
  let recoveredApplying = false;
  let recoveredUndoing = false;

  for (const proposal of proposals.values()) {
    if (proposal.status !== 'applying' && proposal.status !== 'undoing') {
      continue;
    }
    const updatedAt = Date.parse(proposal.updatedAt);
    const staleAfterMs =
      proposal.status === 'applying'
        ? ACTION_PROPOSAL_APPLY_STALE_MS
        : ACTION_PROPOSAL_UNDO_STALE_MS;
    if (Number.isFinite(updatedAt) && now - updatedAt < staleAfterMs) {
      continue;
    }

    const recoveredAt = new Date(now).toISOString();
    if (proposal.status === 'applying') {
      proposals.set(proposal.id, {
        ...proposal,
        result: interruptedApplyResult(proposal, recoveredAt),
        status: 'failed',
        updatedAt: recoveredAt,
      });
      recoveredApplying = true;
    } else {
      // A renderer may have disappeared before or after changing local
      // content. Returning to `applied` is conservative: every supported undo
      // validates an exact fingerprint/history token before mutating, so a
      // retry cannot silently repeat an already-completed destructive undo.
      proposals.set(proposal.id, {
        ...proposal,
        status: 'applied',
        updatedAt: recoveredAt,
      });
      recoveredUndoing = true;
    }
  }

  if (recoveredApplying || recoveredUndoing) {
    persistActionProposals();
  }
  return { recoveredApplying, recoveredUndoing };
}

export function recoverStaleApplyingActionProposals(now = Date.now()) {
  return recoverStaleActionProposalClaims(now).recoveredApplying;
}

export function recoverStaleUndoingActionProposals(now = Date.now()) {
  return recoverStaleActionProposalClaims(now).recoveredUndoing;
}

export function configureActionProposalStore(filePath: string) {
  storePath = filePath;
  proposals.clear();
  if (!existsSync(filePath)) {
    persistActionProposals();
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      proposals?: unknown[];
    };
    let recoveredInterruptedClaim = false;
    for (const stored of parsed.proposals ?? []) {
      const proposal = parseStoredActionProposal(stored);
      if (proposal) {
        if (proposal.status === 'applying') {
          const failedAt = new Date().toISOString();
          proposals.set(proposal.id, {
            ...proposal,
            result: interruptedApplyResult(proposal, failedAt),
            status: 'failed',
            updatedAt: failedAt,
          });
          recoveredInterruptedClaim = true;
        } else if (proposal.status === 'undoing') {
          const recoveredAt = new Date().toISOString();
          proposals.set(proposal.id, {
            ...proposal,
            status: 'applied',
            updatedAt: recoveredAt,
          });
          recoveredInterruptedClaim = true;
        } else {
          proposals.set(proposal.id, proposal);
        }
      }
    }
    trimStoredProposals();
    if (recoveredInterruptedClaim) {
      persistActionProposals();
    }
  } catch {
    proposals.clear();
  }
}

function readString(value: unknown, field: string, max = 100000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new Error(`${field} is too large.`);
  }
  return trimmed;
}

function readOptionalString(value: unknown, max = 1000) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('Optional string field must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new Error('Optional string field is too large.');
  }
  return trimmed || undefined;
}

function readDocMarkdownAction<
  T extends 'create_mindmap' | 'replace_selection',
>(
  body: Record<string, unknown>,
  type: T
): Extract<AgentActionProposal, { type: T }> {
  return {
    docId: readString(body.docId, 'docId', 500),
    markdown: readString(body.markdown, 'markdown'),
    type,
  } as Extract<AgentActionProposal, { type: T }>;
}

function readTitledMarkdownAction<T extends 'create_database' | 'create_note'>(
  body: Record<string, unknown>,
  type: T
): Extract<AgentActionProposal, { type: T }> {
  return {
    markdown: readString(body.markdown, 'markdown'),
    title: readString(body.title, 'title', 240),
    type,
  } as Extract<AgentActionProposal, { type: T }>;
}

export function readActionProposal(input: unknown): AgentActionProposal {
  const body =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const type = body.type;

  switch (type) {
    case 'create_note':
      return readTitledMarkdownAction(body, type);
    case 'insert_markdown': {
      const position = body.position;
      return {
        docId: readString(body.docId, 'docId', 500),
        markdown: readString(body.markdown, 'markdown'),
        position:
          position === 'start' || position === 'selection' || position === 'end'
            ? position
            : 'end',
        type,
      };
    }
    case 'replace_selection':
      return readDocMarkdownAction(body, type);
    case 'create_mindmap':
      return readDocMarkdownAction(body, type);
    case 'create_task_list':
      return {
        docId: readOptionalString(body.docId, 500),
        markdown: readString(body.markdown, 'markdown'),
        title: readString(body.title, 'title', 240),
        type,
      };
    case 'create_database':
      return readTitledMarkdownAction(body, type);
    case 'append_database_rows':
      return {
        databaseBlockId: readOptionalString(
          (body as { databaseBlockId?: unknown }).databaseBlockId,
          500
        ),
        docId: readString((body as { docId?: unknown }).docId, 'docId', 500),
        markdown: readString(
          (body as { markdown?: unknown }).markdown,
          'markdown'
        ),
        type,
      };
    case 'clear_doc':
      return {
        docId: readString((body as { docId?: unknown }).docId, 'docId', 500),
        type,
      };
    case 'run_mcp_tool':
      return {
        args: (body as { args?: unknown }).args ?? {},
        toolName: readString(
          (body as { toolName?: unknown }).toolName,
          'toolName',
          180
        ),
        type,
      };
    default:
      throw new Error(`Unsupported action proposal type: ${String(type)}`);
  }
}

export function createActionProposal(input: {
  proposal: AgentActionProposal;
  reason?: string | null;
  sessionId: string;
  workspaceId: string;
}) {
  if (input.proposal.type === 'clear_doc') {
    throw new Error(
      'Clearing an entire document is disabled until Nota can restore it safely.'
    );
  }
  const now = new Date().toISOString();
  const proposal: StoredActionProposal = {
    createdAt: now,
    id: randomUUID(),
    proposal: input.proposal,
    reason: readOptionalString(input.reason, 1000) ?? null,
    result: null,
    sessionId: readString(input.sessionId, 'sessionId', 500),
    status: 'pending_approval',
    updatedAt: now,
    workspaceId: readString(input.workspaceId, 'workspaceId', 120),
  };
  proposals.set(proposal.id, proposal);
  persistActionProposals();
  return proposal;
}

function getScopedActionProposal(id: string, scope: ActionProposalScope) {
  recoverStaleActionProposalClaims(Date.now());
  const proposal = proposals.get(id);
  if (
    !proposal ||
    proposal.sessionId !== scope.sessionId ||
    proposal.workspaceId !== scope.workspaceId
  ) {
    return null;
  }
  return proposal;
}

export function getActionProposal(id: string, scope: ActionProposalScope) {
  return getScopedActionProposal(id, scope);
}

export function listActionProposals(scope: ActionProposalScope) {
  recoverStaleActionProposalClaims(Date.now());
  return [...proposals.values()]
    .filter(proposal => proposal.workspaceId === scope.workspaceId)
    .filter(proposal => proposal.sessionId === scope.sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const ALLOWED_STATUS_TRANSITIONS: Record<
  StoredActionProposal['status'],
  ReadonlySet<StoredActionProposal['status']>
> = {
  applied: new Set(['undoing']),
  applying: new Set(['applied', 'failed']),
  approved: new Set(['applying', 'rejected']),
  failed: new Set(['approved', 'rejected']),
  pending_approval: new Set(['approved', 'rejected']),
  rejected: new Set(),
  undone: new Set(),
  undoing: new Set(['applied', 'undone']),
};

function transitionActionProposalStatus(
  id: string,
  scope: ActionProposalScope,
  status: StoredActionProposal['status'],
  result?: Record<string, unknown> | null
) {
  const proposal = getScopedActionProposal(id, scope);
  if (!proposal) {
    return null;
  }

  if (!ALLOWED_STATUS_TRANSITIONS[proposal.status].has(status)) {
    throw new Error(
      `Action proposal cannot transition from ${proposal.status} to ${status}.`
    );
  }

  const next: StoredActionProposal = {
    ...proposal,
    result: result === undefined ? proposal.result : result,
    status,
    updatedAt: new Date().toISOString(),
  };
  proposals.set(id, next);
  persistActionProposals();
  return next;
}

export function updateActionProposalStatus(
  id: string,
  scope: ActionProposalScope,
  status: Exclude<StoredActionProposal['status'], 'applying' | 'undoing'>,
  result?: Record<string, unknown> | null
) {
  return transitionActionProposalStatus(id, scope, status, result);
}

export function claimActionProposalForApply(
  id: string,
  scope: ActionProposalScope
) {
  const proposal = getScopedActionProposal(id, scope);
  if (!proposal) {
    return null;
  }
  if (proposal.status !== 'approved') {
    throw new Error(
      `Action proposal cannot be applied from status ${proposal.status}.`
    );
  }
  return transitionActionProposalStatus(id, scope, 'applying');
}

export function claimActionProposalForUndo(
  id: string,
  scope: ActionProposalScope
) {
  const proposal = getScopedActionProposal(id, scope);
  if (!proposal) {
    return null;
  }
  if (proposal.status !== 'applied') {
    throw new Error(
      `Action proposal cannot be undone from status ${proposal.status}.`
    );
  }
  return transitionActionProposalStatus(id, scope, 'undoing');
}
