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

export type StoredActionProposal = {
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
};

export type ActionUndoTarget = {
  fingerprint: string;
  id: string;
};

export type DatabaseActionUndoTarget = ActionUndoTarget;

export type AgentActionUndo =
  | {
      docId: string;
      fingerprint: string;
      type: 'trash_doc';
    }
  | {
      docId: string;
      fingerprint: string;
      undoStackDepth: number;
      undoStackToken: string;
      type: 'editor_history';
    }
  | {
      documentFingerprint: string;
      docId: string;
      target: ActionUndoTarget;
      type: 'delete_block';
    }
  | {
      documentFingerprint: string;
      docId: string;
      targets: ActionUndoTarget[];
      type: 'delete_blocks';
    }
  | {
      columnTargets: DatabaseActionUndoTarget[];
      databaseBlockId: string;
      docId: string;
      rowTargets: DatabaseActionUndoTarget[];
      type: 'delete_database_rows';
    }
  | {
      documentFingerprint: string;
      docId: string;
      target: ActionUndoTarget;
      type: 'delete_surface_element';
    };

export interface ActionApplyMutationResult {
  createdDocFingerprint?: string;
  databaseBlockId?: string;
  databaseColumnTargets?: DatabaseActionUndoTarget[];
  databaseRowTargets?: DatabaseActionUndoTarget[];
  docId: string;
  editorHistoryDepth?: number;
  editorDocumentFingerprint?: string;
  editorHistoryToken?: string;
  insertedBlockDocumentFingerprint?: string;
  insertedBlockId?: string;
  insertedBlockIds?: string[];
  insertedBlockTarget?: ActionUndoTarget;
  insertedBlockTargets?: ActionUndoTarget[];
  insertedSurfaceElementId?: string;
  insertedSurfaceDocumentFingerprint?: string;
  insertedSurfaceElementTarget?: ActionUndoTarget;
}

export interface AppliedActionProposalResult extends Record<string, unknown> {
  appliedAt: string;
  docId: string;
  type: AgentActionProposal['type'];
  undo?: AgentActionUndo;
  workspaceId: string;
}

export interface ChatApplyEditorContainerLike {
  host?: unknown;
}

function isUndoTargets(value: unknown, requireTarget: boolean) {
  if (!Array.isArray(value) || (requireTarget && value.length === 0)) {
    return false;
  }
  const targetIds = new Set<string>();
  return value.every(target => {
    if (!target || typeof target !== 'object') return false;
    const record = target as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      !record.id ||
      typeof record.fingerprint !== 'string' ||
      !record.fingerprint ||
      targetIds.has(record.id)
    ) {
      return false;
    }
    targetIds.add(record.id);
    return true;
  });
}

function isUndoTarget(value: unknown) {
  return isUndoTargets([value], true);
}

export type ActionProposalDocPermission = {
  action: 'Doc_Trash' | 'Doc_Update';
  docId: string;
};

export type ActionProposalPermission =
  | ActionProposalDocPermission
  | { action: 'Workspace_CreateDoc' };

function truncateTitle(value: string, max = 120) {
  return value.length > max ? value.slice(0, max) : value;
}

export function unwrapMarkdownFence(markdown: string) {
  const withoutSources = markdown.replace(/\n\nSources:\n[\s\S]*$/i, '').trim();
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(
    withoutSources
  );
  return fenced?.[1]?.trim() ?? withoutSources;
}

export function titleFromMarkdown(markdown: string, fallback: string) {
  const unwrapped = unwrapMarkdownFence(markdown);
  const heading = /^#\s+(.+)$/m.exec(unwrapped)?.[1]?.trim();
  if (heading) {
    return truncateTitle(heading);
  }
  const firstLine = unwrapped
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*#\s]+/, '').trim())
    .find(Boolean);
  return truncateTitle(firstLine || fallback || 'Generated note');
}

export function proposalTitle(proposal: AgentActionProposal) {
  switch (proposal.type) {
    case 'create_note':
    case 'create_database':
    case 'create_task_list':
      return proposal.title;
    case 'create_mindmap':
      return 'Create mindmap';
    case 'append_database_rows':
      return `Append database rows in ${proposal.docId}`;
    case 'clear_doc':
      return `Clear ${proposal.docId}`;
    case 'insert_markdown':
      return `Insert into ${proposal.docId}`;
    case 'replace_selection':
      return `Replace selection in ${proposal.docId}`;
    case 'run_mcp_tool':
      return `Run ${proposal.toolName}`;
  }
}

export function proposalPreview(proposal: AgentActionProposal) {
  if (proposal.type === 'run_mcp_tool') {
    return JSON.stringify(proposal.args ?? {}, null, 2);
  }
  if (proposal.type === 'clear_doc') {
    return 'Remove all body blocks from the target document.';
  }
  return proposal.markdown;
}

export function canUndoAppliedProposal(stored: StoredActionProposal) {
  const undo = stored.result?.undo;
  if (!undo || typeof undo !== 'object') {
    return false;
  }
  const record = undo as Record<string, unknown>;
  return (
    stored.status === 'applied' &&
    ((record.type === 'trash_doc' &&
      typeof record.docId === 'string' &&
      !!record.docId &&
      typeof record.fingerprint === 'string' &&
      !!record.fingerprint) ||
      (record.type === 'editor_history' &&
        typeof record.docId === 'string' &&
        !!record.docId &&
        typeof record.fingerprint === 'string' &&
        !!record.fingerprint &&
        Number.isSafeInteger(record.undoStackDepth) &&
        Number(record.undoStackDepth) > 0 &&
        typeof record.undoStackToken === 'string' &&
        !!record.undoStackToken) ||
      (record.type === 'delete_block' &&
        typeof record.documentFingerprint === 'string' &&
        !!record.documentFingerprint &&
        typeof record.docId === 'string' &&
        !!record.docId &&
        isUndoTarget(record.target)) ||
      (record.type === 'delete_blocks' &&
        typeof record.documentFingerprint === 'string' &&
        !!record.documentFingerprint &&
        typeof record.docId === 'string' &&
        !!record.docId &&
        isUndoTargets(record.targets, true)) ||
      (record.type === 'delete_database_rows' &&
        typeof record.docId === 'string' &&
        !!record.docId &&
        typeof record.databaseBlockId === 'string' &&
        !!record.databaseBlockId &&
        isUndoTargets(record.rowTargets, true) &&
        isUndoTargets(record.columnTargets, false)) ||
      (record.type === 'delete_surface_element' &&
        typeof record.documentFingerprint === 'string' &&
        !!record.documentFingerprint &&
        typeof record.docId === 'string' &&
        !!record.docId &&
        isUndoTarget(record.target)))
  );
}

export function undoInfo(stored: StoredActionProposal) {
  const undo = stored.result?.undo;
  if (!undo || typeof undo !== 'object') {
    return null;
  }
  const record = undo as Record<string, unknown>;
  const docId = record.docId;
  const columnTargets = record.columnTargets;
  const databaseBlockId = record.databaseBlockId;
  const documentFingerprint = record.documentFingerprint;
  const fingerprint = record.fingerprint;
  const target = record.target;
  const targets = record.targets;
  const undoStackDepth = record.undoStackDepth;
  const undoStackToken = record.undoStackToken;
  const rowTargets = record.rowTargets;
  if (
    record.type === 'trash_doc' &&
    typeof docId === 'string' &&
    docId &&
    typeof fingerprint === 'string' &&
    fingerprint
  ) {
    return { type: 'trash_doc' as const, docId, fingerprint };
  }
  if (
    record.type === 'editor_history' &&
    typeof docId === 'string' &&
    docId &&
    Number.isSafeInteger(undoStackDepth) &&
    Number(undoStackDepth) > 0 &&
    typeof undoStackToken === 'string' &&
    undoStackToken &&
    typeof fingerprint === 'string' &&
    fingerprint
  ) {
    return {
      type: 'editor_history' as const,
      docId,
      fingerprint,
      undoStackDepth: Number(undoStackDepth),
      undoStackToken,
    };
  }
  if (
    record.type === 'delete_block' &&
    typeof documentFingerprint === 'string' &&
    documentFingerprint &&
    typeof docId === 'string' &&
    docId &&
    isUndoTarget(target)
  ) {
    return {
      type: 'delete_block' as const,
      documentFingerprint,
      docId,
      target: target as ActionUndoTarget,
    };
  }
  if (
    record.type === 'delete_blocks' &&
    typeof documentFingerprint === 'string' &&
    documentFingerprint &&
    typeof docId === 'string' &&
    docId &&
    isUndoTargets(targets, true)
  ) {
    return {
      type: 'delete_blocks' as const,
      documentFingerprint,
      docId,
      targets: targets as ActionUndoTarget[],
    };
  }
  if (
    record.type === 'delete_database_rows' &&
    typeof docId === 'string' &&
    docId &&
    typeof databaseBlockId === 'string' &&
    databaseBlockId &&
    isUndoTargets(rowTargets, true) &&
    isUndoTargets(columnTargets, false)
  ) {
    return {
      type: 'delete_database_rows' as const,
      columnTargets: columnTargets as DatabaseActionUndoTarget[],
      databaseBlockId,
      docId,
      rowTargets: rowTargets as DatabaseActionUndoTarget[],
    };
  }
  if (
    record.type === 'delete_surface_element' &&
    typeof documentFingerprint === 'string' &&
    documentFingerprint &&
    typeof docId === 'string' &&
    docId &&
    isUndoTarget(target)
  ) {
    return {
      type: 'delete_surface_element' as const,
      documentFingerprint,
      docId,
      target: target as ActionUndoTarget,
    };
  }
  return null;
}

export function canApplyFromChat(
  stored: StoredActionProposal,
  editorContainer?: ChatApplyEditorContainerLike | null,
  applyingProposalId?: string | null
) {
  const retryable =
    stored.status === 'failed' && stored.result?.retryable === true;
  const needsActiveSelection =
    stored.proposal.type === 'replace_selection' ||
    (stored.proposal.type === 'insert_markdown' &&
      stored.proposal.position === 'selection');
  return (
    !applyingProposalId &&
    stored.proposal.type !== 'clear_doc' &&
    (stored.status === 'pending_approval' ||
      stored.status === 'approved' ||
      retryable) &&
    (!needsActiveSelection || !!editorContainer?.host)
  );
}

export function assertActionProposalWorkspace(
  stored: StoredActionProposal,
  activeWorkspaceId: string
) {
  if (!stored.workspaceId || stored.workspaceId !== activeWorkspaceId) {
    throw new Error(
      'This AI action belongs to a different workspace and cannot be changed here.'
    );
  }
}

export function applyPermissionForActionProposal(
  proposal: AgentActionProposal
): ActionProposalPermission | null {
  switch (proposal.type) {
    case 'append_database_rows':
    case 'clear_doc':
    case 'create_mindmap':
    case 'insert_markdown':
    case 'replace_selection':
      return { action: 'Doc_Update', docId: proposal.docId };
    case 'create_task_list':
      return proposal.docId
        ? { action: 'Doc_Update', docId: proposal.docId }
        : { action: 'Workspace_CreateDoc' };
    case 'create_database':
    case 'create_note':
      return { action: 'Workspace_CreateDoc' };
    case 'run_mcp_tool':
      return null;
  }
}

export function undoPermissionForActionProposal(
  undo: AgentActionUndo
): ActionProposalDocPermission {
  return {
    action: undo.type === 'trash_doc' ? 'Doc_Trash' : 'Doc_Update',
    docId: undo.docId,
  };
}

export function databaseMarkdown(title: string, markdown: string) {
  const trimmed = markdown.trim();
  if (/\|.+\|/.test(trimmed)) {
    return `# ${title}\n\n${trimmed}`;
  }

  const rows = trimmed
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim()
    )
    .filter(Boolean);

  if (!rows.length) {
    return [
      `# ${title}`,
      '',
      '| Item | Status | Notes |',
      '| --- | --- | --- |',
      '| Untitled | Not started | |',
    ].join('\n');
  }

  return [
    `# ${title}`,
    '',
    '| Item | Status | Notes |',
    '| --- | --- | --- |',
    ...rows.map(row => `| ${row.replace(/\|/g, '\\|')} | Not started | |`),
  ].join('\n');
}

export function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function isMarkdownTableSeparator(cells: string[]) {
  return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
}

export function parseDatabaseMarkdown(title: string, markdown: string) {
  const lines = markdown
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const tableLines = lines.filter(line => line.includes('|'));

  if (tableLines.length >= 2) {
    const header = splitMarkdownTableRow(tableLines[0] ?? '');
    const maybeSeparator = splitMarkdownTableRow(tableLines[1] ?? '');
    const hasSeparator = isMarkdownTableSeparator(maybeSeparator);
    const bodyLines = hasSeparator ? tableLines.slice(2) : tableLines.slice(1);
    const rows = bodyLines
      .map(splitMarkdownTableRow)
      .filter(row => row.some(Boolean));

    if (header.some(Boolean) && rows.length) {
      return {
        headers: header.map((cell, index) => cell || `Column ${index + 1}`),
        rows,
      };
    }
  }

  const rows = lines
    .map(line =>
      line
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim()
    )
    .filter(Boolean)
    .map(line => [line, 'Not started', '']);

  return {
    headers: ['Item', 'Status', 'Notes'],
    rows: rows.length ? rows : [[title, 'Not started', '']],
  };
}

export function normalizeDatabaseHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildAppliedActionProposalResult(options: {
  appliedAt?: string;
  mutation: ActionApplyMutationResult;
  proposal: AgentActionProposal;
  workspaceId: string;
}): AppliedActionProposalResult {
  const {
    createdDocFingerprint,
    databaseBlockId,
    databaseColumnTargets,
    databaseRowTargets,
    docId,
    editorDocumentFingerprint,
    editorHistoryDepth,
    editorHistoryToken,
    insertedBlockDocumentFingerprint,
    insertedBlockTarget,
    insertedBlockTargets,
    insertedSurfaceElementTarget,
    insertedSurfaceDocumentFingerprint,
  } = options.mutation;
  const undo =
    options.proposal.type === 'create_note' ||
    options.proposal.type === 'create_database' ||
    (options.proposal.type === 'create_task_list' && !options.proposal.docId)
      ? createdDocFingerprint
        ? {
            type: 'trash_doc' as const,
            docId,
            fingerprint: createdDocFingerprint,
          }
        : undefined
      : options.proposal.type === 'replace_selection' &&
          Number.isSafeInteger(editorHistoryDepth) &&
          Number(editorHistoryDepth) > 0 &&
          typeof editorHistoryToken === 'string' &&
          editorHistoryToken &&
          typeof editorDocumentFingerprint === 'string' &&
          editorDocumentFingerprint
        ? {
            type: 'editor_history' as const,
            docId,
            fingerprint: editorDocumentFingerprint,
            undoStackDepth: Number(editorHistoryDepth),
            undoStackToken: editorHistoryToken,
          }
        : options.proposal.type === 'append_database_rows'
          ? databaseRowTargets?.length &&
            typeof databaseBlockId === 'string' &&
            databaseBlockId &&
            Array.isArray(databaseColumnTargets)
            ? {
                type: 'delete_database_rows' as const,
                columnTargets: databaseColumnTargets,
                databaseBlockId,
                docId,
                rowTargets: databaseRowTargets,
              }
            : undefined
          : insertedBlockTargets?.length
            ? insertedBlockDocumentFingerprint
              ? {
                  type: 'delete_blocks' as const,
                  documentFingerprint: insertedBlockDocumentFingerprint,
                  docId,
                  targets: insertedBlockTargets,
                }
              : undefined
            : insertedBlockTarget
              ? insertedBlockDocumentFingerprint
                ? {
                    type: 'delete_block' as const,
                    documentFingerprint: insertedBlockDocumentFingerprint,
                    docId,
                    target: insertedBlockTarget,
                  }
                : undefined
              : insertedSurfaceElementTarget
                ? insertedSurfaceDocumentFingerprint
                  ? {
                      type: 'delete_surface_element' as const,
                      documentFingerprint: insertedSurfaceDocumentFingerprint,
                      docId,
                      target: insertedSurfaceElementTarget,
                    }
                  : undefined
                : undefined;

  return {
    appliedAt: options.appliedAt ?? new Date().toISOString(),
    docId,
    type: options.proposal.type,
    undo,
    workspaceId: options.workspaceId,
  };
}
