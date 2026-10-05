import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
  executeApprovedMcpTool: vi.fn(),
}));

vi.mock('./mcp', async importOriginal => {
  const actual = await importOriginal<typeof import('./mcp.js')>();
  return {
    ...actual,
    executeApprovedMcpTool: mcpMocks.executeApprovedMcpTool,
  };
});

import { createServer } from './server.js';

const TOKEN = 'test-nota-proposal-token';
const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  settingsPath: process.env.NOTA_AI_SETTINGS_PATH,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

let temporaryRoot = '';
let baseUrl = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nota-server-proposals-')
  );
  process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
  process.env.NOTA_AI_WORKSPACE_ROOT = temporaryRoot;
  process.env.NOTA_AI_SETTINGS_PATH = path.join(
    temporaryRoot,
    '.nota',
    'ai-settings.json'
  );
  mcpMocks.executeApprovedMcpTool.mockReset();

  const { app } = createServer();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
  await rm(temporaryRoot, { force: true, recursive: true });

  for (const [name, value] of Object.entries({
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_SETTINGS_PATH: originalEnvironment.settingsPath,
    NOTA_AI_WORKSPACE_ROOT: originalEnvironment.workspaceRoot,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

async function request(
  pathname: string,
  options: { body?: unknown; method?: string } = {}
) {
  return fetch(`${baseUrl}${pathname}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      'x-nota-backend-token': TOKEN,
    },
    method: options.method,
  });
}

async function createSession(workspaceId: string) {
  const response = await request('/graphql', {
    body: {
      operationName: 'createCopilotSession',
      variables: {
        options: {
          promptName: 'Chat With Nota AI',
          workspaceId,
        },
      },
    },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { createCopilotSession: string };
  };
  return body.data.createCopilotSession;
}

async function sessionMessageContents(scope: {
  sessionId: string;
  workspaceId: string;
}) {
  const response = await request('/graphql', {
    body: {
      operationName: 'getCopilotSession',
      variables: {
        options: { sessionId: scope.sessionId },
        workspaceId: scope.workspaceId,
      },
    },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: {
      currentUser: {
        copilot: {
          chats: {
            edges: Array<{
              node: {
                messages: Array<{ content: string }>;
                sessionId: string;
              };
            }>;
          };
        };
      };
    };
  };
  return (
    body.data.currentUser.copilot.chats.edges
      .map(edge => edge.node)
      .find(chat => chat.sessionId === scope.sessionId)
      ?.messages.map(message => message.content) ?? []
  );
}

async function createMcpProposal(scope: {
  sessionId: string;
  workspaceId: string;
}) {
  const response = await request('/v1/agent/actions/proposals', {
    body: {
      ...scope,
      proposal: {
        args: { title: 'Approved note' },
        toolName: 'mcp_notes_create_note',
        type: 'run_mcp_tool',
      },
      reason: 'Create the requested note.',
    },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    proposal: { id: string; status: string };
  };
  return body.proposal;
}

async function createLocalProposal(scope: {
  sessionId: string;
  workspaceId: string;
}) {
  const response = await request('/v1/agent/actions/proposals', {
    body: {
      ...scope,
      proposal: {
        markdown: '# Claimed note',
        title: 'Claimed note',
        type: 'create_note',
      },
      reason: 'Create the requested note.',
    },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    proposal: { id: string; status: string };
  };
  return body.proposal;
}

async function patchProposal(
  id: string,
  scope: { sessionId: string; workspaceId: string },
  status: string,
  result?: Record<string, unknown>
) {
  return request(`/v1/agent/actions/proposals/${id}`, {
    body: { ...scope, result, status },
    method: 'PATCH',
  });
}

describe('scoped action proposal routes', () => {
  it('requires a trusted session/workspace pair and hides other scopes', async () => {
    const alphaScope = {
      sessionId: await createSession('workspace-alpha'),
      workspaceId: 'workspace-alpha',
    };
    const betaScope = {
      sessionId: await createSession('workspace-beta'),
      workspaceId: 'workspace-beta',
    };

    const missingScope = await request('/v1/agent/actions/proposals', {
      body: {
        proposal: {
          args: {},
          toolName: 'mcp_notes_create_note',
          type: 'run_mcp_tool',
        },
      },
      method: 'POST',
    });
    expect(missingScope.status).toBe(400);

    const mismatchedScope = await request('/v1/agent/actions/proposals', {
      body: {
        ...alphaScope,
        workspaceId: betaScope.workspaceId,
        proposal: {
          args: {},
          toolName: 'mcp_notes_create_note',
          type: 'run_mcp_tool',
        },
      },
      method: 'POST',
    });
    expect(mismatchedScope.status).toBe(403);

    const proposal = await createMcpProposal(alphaScope);
    const disabledClear = await request('/v1/agent/actions/proposals', {
      body: {
        ...alphaScope,
        proposal: { docId: 'doc-1', type: 'clear_doc' },
      },
      method: 'POST',
    });
    expect(disabledClear.status).toBe(400);
    expect(((await disabledClear.json()) as { error: string }).error).toMatch(
      /disabled until Nota can restore it safely/
    );

    const otherScopeRead = await request(
      `/v1/agent/actions/proposals/${proposal.id}?workspaceId=${betaScope.workspaceId}&sessionId=${betaScope.sessionId}`
    );
    expect(otherScopeRead.status).toBe(404);

    const otherScopeUpdate = await patchProposal(
      proposal.id,
      betaScope,
      'approved'
    );
    expect(otherScopeUpdate.status).toBe(404);

    const approved = await patchProposal(proposal.id, alphaScope, 'approved', {
      workspaceId: betaScope.workspaceId,
    });
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as {
      proposal: { result: { workspaceId: string }; status: string };
    };
    expect(approvedBody.proposal.status).toBe('approved');
    expect(approvedBody.proposal.result.workspaceId).toBe(
      alphaScope.workspaceId
    );
  });

  it('requires explicit approval and atomically prevents duplicate MCP execution', async () => {
    const scope = {
      sessionId: await createSession('workspace-alpha'),
      workspaceId: 'workspace-alpha',
    };
    const proposal = await createMcpProposal(scope);

    const pendingApply = await request(
      `/v1/agent/actions/proposals/${proposal.id}/apply`,
      { body: scope, method: 'POST' }
    );
    expect(pendingApply.status).toBe(409);
    expect(mcpMocks.executeApprovedMcpTool).not.toHaveBeenCalled();

    expect((await patchProposal(proposal.id, scope, 'approved')).status).toBe(
      200
    );

    let finishExecution!: (result: Record<string, unknown>) => void;
    mcpMocks.executeApprovedMcpTool.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishExecution = resolve;
        })
    );

    const firstApply = request(
      `/v1/agent/actions/proposals/${proposal.id}/apply`,
      { body: scope, method: 'POST' }
    );
    await vi.waitFor(() => {
      expect(mcpMocks.executeApprovedMcpTool).toHaveBeenCalledTimes(1);
    });

    const duplicateApply = await request(
      `/v1/agent/actions/proposals/${proposal.id}/apply`,
      { body: scope, method: 'POST' }
    );
    expect(duplicateApply.status).toBe(409);
    expect(mcpMocks.executeApprovedMcpTool).toHaveBeenCalledTimes(1);

    const forgedMcpCompletion = await patchProposal(
      proposal.id,
      scope,
      'applied',
      { forged: true }
    );
    expect(forgedMcpCompletion.status).toBe(409);

    finishExecution({
      namespacedToolName: 'mcp_notes_create_note',
      result: { created: true },
      serverName: 'notes',
      toolName: 'create_note',
    });
    const applied = await firstApply;
    expect(applied.status).toBe(200);
    const appliedBody = (await applied.json()) as {
      proposal: { status: string };
    };
    expect(appliedBody.proposal.status).toBe('applied');
  });

  it('atomically claims local editor mutations before they can be completed', async () => {
    const scope = {
      sessionId: await createSession('workspace-alpha'),
      workspaceId: 'workspace-alpha',
    };
    const proposal = await createLocalProposal(scope);

    const pendingClaim = await request(
      `/v1/agent/actions/proposals/${proposal.id}/claim`,
      { body: scope, method: 'POST' }
    );
    expect(pendingClaim.status).toBe(409);

    expect((await patchProposal(proposal.id, scope, 'approved')).status).toBe(
      200
    );
    const unclaimedCompletion = await patchProposal(
      proposal.id,
      scope,
      'applied',
      { docId: 'should-not-apply' }
    );
    expect(unclaimedCompletion.status).toBe(409);

    const claim = await request(
      `/v1/agent/actions/proposals/${proposal.id}/claim`,
      { body: scope, method: 'POST' }
    );
    expect(claim.status).toBe(200);
    expect(
      ((await claim.json()) as { proposal: { status: string } }).proposal.status
    ).toBe('applying');

    const duplicateClaim = await request(
      `/v1/agent/actions/proposals/${proposal.id}/claim`,
      { body: scope, method: 'POST' }
    );
    expect(duplicateClaim.status).toBe(409);

    const completed = await patchProposal(proposal.id, scope, 'applied', {
      appliedAt: 'now',
      docId: 'new-doc',
      undo: {
        docId: 'new-doc',
        fingerprint: 'new-doc-fingerprint',
        type: 'trash_doc',
      },
      workspaceId: 'workspace-beta',
    });
    expect(completed.status).toBe(200);
    const completedBody = (await completed.json()) as {
      proposal: {
        result: { docId: string; workspaceId: string };
        status: string;
      };
    };
    expect(completedBody.proposal.status).toBe('applied');
    expect(completedBody.proposal.result.docId).toBe('new-doc');
    expect(completedBody.proposal.result.workspaceId).toBe(scope.workspaceId);

    const unclaimedUndo = await patchProposal(proposal.id, scope, 'undone');
    expect(unclaimedUndo.status).toBe(409);

    const undoClaim = await request(
      `/v1/agent/actions/proposals/${proposal.id}/undo-claim`,
      { body: scope, method: 'POST' }
    );
    expect(undoClaim.status).toBe(200);
    expect(
      ((await undoClaim.json()) as { proposal: { status: string } }).proposal
        .status
    ).toBe('undoing');

    const duplicateUndoClaim = await request(
      `/v1/agent/actions/proposals/${proposal.id}/undo-claim`,
      { body: scope, method: 'POST' }
    );
    expect(duplicateUndoClaim.status).toBe(409);

    const invalidUndoCompletion = await patchProposal(
      proposal.id,
      scope,
      'failed'
    );
    expect(invalidUndoCompletion.status).toBe(409);

    const returnedToApplied = await patchProposal(
      proposal.id,
      scope,
      'applied'
    );
    expect(returnedToApplied.status).toBe(200);
    expect(
      (
        (await returnedToApplied.json()) as {
          proposal: { status: string };
        }
      ).proposal.status
    ).toBe('applied');

    expect(
      (
        await request(`/v1/agent/actions/proposals/${proposal.id}/undo-claim`, {
          body: scope,
          method: 'POST',
        })
      ).status
    ).toBe(200);
    const undone = await patchProposal(proposal.id, scope, 'undone', {
      undoneAt: 'now',
    });
    expect(undone.status).toBe(200);
    expect(
      ((await undone.json()) as { proposal: { status: string } }).proposal
        .status
    ).toBe('undone');
    const messages = await sessionMessageContents(scope);
    expect(
      messages.filter(message => message.startsWith('Applied Nota AI action:'))
    ).toHaveLength(1);
    expect(
      messages.filter(message => message.startsWith('Undid Nota AI action:'))
    ).toHaveLength(1);
  });

  it('persists failed execution and requires reapproval before retry', async () => {
    const scope = {
      sessionId: await createSession('workspace-alpha'),
      workspaceId: 'workspace-alpha',
    };
    const proposal = await createMcpProposal(scope);
    expect((await patchProposal(proposal.id, scope, 'approved')).status).toBe(
      200
    );

    mcpMocks.executeApprovedMcpTool.mockRejectedValueOnce(
      new Error('temporary MCP failure')
    );
    const failed = await request(
      `/v1/agent/actions/proposals/${proposal.id}/apply`,
      { body: scope, method: 'POST' }
    );
    expect(failed.status).toBe(502);
    const failedBody = (await failed.json()) as {
      proposal: {
        result: {
          error: string;
          retryable: boolean;
          reviewRequired: boolean;
        };
        status: string;
      };
    };
    expect(failedBody.proposal.status).toBe('failed');
    expect(failedBody.proposal.result.error).toBe('temporary MCP failure');
    expect(failedBody.proposal.result.retryable).toBe(false);
    expect(failedBody.proposal.result.reviewRequired).toBe(true);

    const retryWithoutApproval = await request(
      `/v1/agent/actions/proposals/${proposal.id}/apply`,
      { body: scope, method: 'POST' }
    );
    expect(retryWithoutApproval.status).toBe(409);
    expect(mcpMocks.executeApprovedMcpTool).toHaveBeenCalledTimes(1);

    expect((await patchProposal(proposal.id, scope, 'approved')).status).toBe(
      200
    );
    mcpMocks.executeApprovedMcpTool.mockResolvedValueOnce({
      namespacedToolName: 'mcp_notes_create_note',
      result: { created: true },
      serverName: 'notes',
      toolName: 'create_note',
    });
    const retried = await request(
      `/v1/agent/actions/proposals/${proposal.id}/apply`,
      { body: scope, method: 'POST' }
    );
    expect(retried.status).toBe(200);
    expect(mcpMocks.executeApprovedMcpTool).toHaveBeenCalledTimes(2);
  });
});
