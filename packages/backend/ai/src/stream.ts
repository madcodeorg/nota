import { generateImage, type ModelMessage, stepCountIs, streamText } from 'ai';
import type { Request, Response } from 'express';

import { type AgentActionProposal, createActionProposal } from './actions';
import type { AiBackendConfig } from './config';
import { assertLocalOnnxTextReady } from './local-onnx';
import { isLocalOnnxTextModel } from './model-registry';
import { systemPromptFor } from './prompts';
import type { AiModelRouter, TextModelRuntime } from './providers';
import { resolveReasoning } from './reasoning';
import type { CopilotStore } from './store';
import { assertBackendTextModelAvailable } from './text-runtime';
import { createNotaToolContext, type NotaToolContext } from './tools';
import type { CopilotSession, StreamObject } from './types';
import {
  listWorkspaceDocuments,
  readWorkspaceDocument,
  searchWorkspace,
  workspaceSearchNeeded,
  type WorkspaceSearchResult,
} from './workspace-search';

function writeSse(res: Response, event: string, data: string) {
  res.write(`event: ${event}\n`);
  for (const line of data.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

function writeSseHead(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

function abortTextRequestOnDisconnect(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort();
    }
  };
  const requestClosed = () => {
    if (req.aborted || !req.complete) {
      abort();
    }
  };

  req.once('aborted', abort);
  req.once('close', requestClosed);
  res.once('close', abort);

  return {
    controller,
    cleanup() {
      req.off('aborted', abort);
      req.off('close', requestClosed);
      res.off('close', abort);
    },
  };
}

function normalizeSessionId(value: unknown) {
  if (typeof value !== 'string') return null;
  const sessionId = value.trim();
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
    return null;
  }
  return sessionId;
}

function writeSseError(res: Response, status: number, message: string) {
  writeSse(
    res,
    'error',
    JSON.stringify({
      status,
      message,
    })
  );
  res.end();
}

function truncate(value: string, max = 12000) {
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formatParams(params: Record<string, unknown> | null | undefined) {
  if (!params) return '';

  const sections: string[] = [];
  const selectedMarkdown = formatValue(params.selectedMarkdown);
  const html = formatValue(params.html);
  const docs = Array.isArray(params.docs) ? params.docs : [];
  const files = Array.isArray(params.files) ? params.files : [];
  const mindmap = formatValue(params.mindmap);
  const node = formatValue(params.node);
  const language = formatValue(params.language);
  const tone = formatValue(params.tone);

  if (selectedMarkdown) {
    sections.push(`Selected Markdown:\n${truncate(selectedMarkdown)}`);
  }
  if (html) {
    sections.push(`Selected HTML:\n${truncate(html)}`);
  }
  if (docs.length) {
    sections.push(`Workspace Docs:\n${truncate(formatValue(docs))}`);
  }
  if (files.length) {
    sections.push(`Workspace Files:\n${truncate(formatValue(files))}`);
  }
  if (mindmap) {
    sections.push(`Existing Mindmap:\n${truncate(mindmap)}`);
  }
  if (node) {
    sections.push(`Selected Mindmap Node:\n${truncate(node)}`);
  }
  if (language) {
    sections.push(`Target Language: ${language}`);
  }
  if (tone) {
    sections.push(`Target Tone: ${tone}`);
  }

  return sections.length ? `\n\nContext:\n${sections.join('\n\n')}` : '';
}

function messageContent(
  message: ReturnType<CopilotStore['requireSession']>['messages'][number]
) {
  return `${message.content}${formatParams(message.params)}`;
}

function imagePartFromAttachment(attachment: string) {
  if (!attachment.startsWith('data:image/')) {
    return null;
  }
  return {
    image: attachment,
    type: 'image' as const,
  };
}

export function toModelMessages(
  session: ReturnType<CopilotStore['requireSession']>,
  runtime: TextModelRuntime
) {
  const messages: ModelMessage[] = [];
  for (const message of session.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = messageContent(message);
    const imageParts =
      runtime !== 'local-onnx' && message.role === 'user'
        ? message.attachments
            .map(imagePartFromAttachment)
            .filter(
              (
                part
              ): part is NonNullable<
                ReturnType<typeof imagePartFromAttachment>
              > => !!part
            )
        : [];
    if (!content && !imageParts.length) continue;
    if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: imageParts.length
          ? [{ text: content || 'Attached image', type: 'text' }, ...imageParts]
          : content,
      });
      continue;
    }
    messages.push({
      role: 'assistant',
      content,
    });
  }
  return messages;
}

function systemPromptWithTools(promptName: string, toolsEnabled: boolean) {
  const prompt = systemPromptFor(promptName);
  if (!toolsEnabled) return prompt;

  return [
    prompt,
    'You may use Nota workspace tools when they are relevant.',
    'Use tools only to help with Nota notes, workspace content, summaries, research, or local project context.',
    'Use search_nota_workspace to find relevant passages. Use list_nota_documents to discover exact document ids, then read_nota_document when you need to inspect a complete document or verify exact wording. These tools are already restricted to the current user and workspace; never guess that an inaccessible document exists.',
    'When search_nota_workspace returns results, cite relevant sources using the result docId and blockId, for example [source: path/to/doc.md#line:12]. Prefer higher-scored local-neural-embedding results when available, then local-hash-embedding results.',
    'When read_nota_document returns a sourceRef, cite it as [source: nota://workspaceId/docId]. Use document tools, not nota_shell, to inspect Nota note content.',
    'When the user asks you to create or edit notes, mindmaps, selections, task lists, or simple databases/tables, call propose_nota_action. Never claim the action was applied until the frontend approves and applies it.',
    'Whole-document clearing is disabled until Nota can restore it safely. Do not propose or claim to perform a clear, wipe, or delete-all action.',
    'When MCP tools are configured, use list_mcp_tools to inspect direct read tools and approval-gated write tools. For gated MCP writes, call propose_nota_action with type run_mcp_tool and the exact gated tool name.',
    'Do not use shell commands for destructive changes. Treat shell output as local Nota context, then answer in normal Markdown.',
  ].join(' ');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : { value };
}

function latestUserMessage(
  session: ReturnType<CopilotStore['requireSession']>
) {
  return [...session.messages]
    .reverse()
    .find(message => message.role === 'user');
}

export function workspaceContentAccessForRequest(toolsConfig: unknown) {
  if (toolsConfig === undefined) {
    return true;
  }
  if (typeof toolsConfig !== 'string') {
    return false;
  }

  try {
    const parsed = JSON.parse(toolsConfig) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const config = parsed as Record<string, unknown>;
    for (const key of ['searchWorkspace', 'readingDocs']) {
      if (key in config && typeof config[key] !== 'boolean') {
        return false;
      }
    }
    return config.searchWorkspace !== false && config.readingDocs !== false;
  } catch {
    // An explicitly supplied but malformed privacy setting must fail closed.
    return false;
  }
}

export function configForRequestWorkspaceAccess(
  config: AiBackendConfig,
  workspaceContentAccess: boolean
) {
  if (workspaceContentAccess || !config.workspaceSearchToolEnabled) {
    return config;
  }
  return {
    ...config,
    workspaceSearchToolEnabled: false,
  };
}

function sourceRef(result: WorkspaceSearchResult) {
  return (
    result.citation?.ref ??
    result.sourceRef ??
    `${result.docId}${result.blockId ? `#${result.blockId}` : ''}`
  );
}

function formatSearchResults(results: WorkspaceSearchResult[]) {
  if (!results.length) {
    return '';
  }
  return [
    'Local Nota workspace search results:',
    ...results
      .slice(0, 6)
      .map(
        result =>
          `- ${result.title}${
            result.section ? ` / ${result.section}` : ''
          } [source: ${sourceRef(result)}, score: ${result.score}]\n${truncate(
            result.snippet,
            800
          )}`
      ),
  ].join('\n\n');
}

function formatSourceSection(results: WorkspaceSearchResult[]) {
  const sources = results.slice(0, 5);
  if (!sources.length) {
    return '';
  }

  return [
    '\n\nSources:',
    ...sources.map(
      result =>
        `- ${result.title}${result.section ? ` / ${result.section}` : ''} [source: ${sourceRef(result)}]`
    ),
  ].join('\n');
}

function shouldAppendSourceSection(
  assistantText: string,
  results: WorkspaceSearchResult[]
) {
  return results.length > 0 && !/\[source:\s*[^\]]+\]/i.test(assistantText);
}

async function workspaceContext(input: {
  config: AiBackendConfig;
  session: CopilotSession;
}): Promise<{
  context: string;
  query: string;
  results: WorkspaceSearchResult[];
  searchType: string;
}> {
  const empty = {
    context: '',
    query: '',
    results: [] as WorkspaceSearchResult[],
    searchType: 'none',
  };

  if (!input.config.toolsEnabled || !input.config.workspaceSearchToolEnabled) {
    return empty;
  }

  const user = latestUserMessage(input.session);
  const query = user ? messageContent(user).trim() : '';
  if (!query || !workspaceSearchNeeded(query)) {
    return empty;
  }

  const search = await searchWorkspace(input.config, {
    limit: 6,
    query,
    userId: 'local-user',
    workspaceId: input.session.workspaceId,
  });
  return {
    context: formatSearchResults(search.results),
    query,
    results: search.results,
    searchType: search.searchType,
  };
}

export function localWorkspaceDocumentMode(content: string) {
  const normalized = content.toLowerCase();
  if (
    /\b(read|inspect|review|summari[sz]e|quote|verify|open)\b/.test(
      normalized
    ) ||
    /\b(entire|full|complete|exact)\b.{0,40}\b(note|document|doc|page|transcript)\b/.test(
      normalized
    ) ||
    /\bwhat(?:'s| is)\s+(?:in|inside)\b/.test(normalized)
  ) {
    return 'read' as const;
  }
  if (
    /\b(list|show|which|what)\b.{0,60}\b(notes?|documents?|docs?|pages?)\b/.test(
      normalized
    ) ||
    /\b(notes?|documents?|docs?|pages?)\b.{0,40}\b(?:do i have|are available|exist)\b/.test(
      normalized
    )
  ) {
    return 'list' as const;
  }
  return 'search' as const;
}

function normalizeLocalDocumentReference(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function resolveLocalOnnxTargetDocument(
  content: string,
  candidates: readonly { docId: string; title: string }[]
) {
  const normalizedContent = normalizeLocalDocumentReference(content);
  if (!normalizedContent) {
    return { docId: null, status: 'missing' as const };
  }

  const contentWithBoundaries = ` ${normalizedContent} `;
  const matches = candidates
    .map(candidate => ({
      docId: candidate.docId.trim(),
      title: normalizeLocalDocumentReference(candidate.title),
    }))
    .filter(
      candidate =>
        candidate.docId &&
        candidate.title &&
        contentWithBoundaries.includes(` ${candidate.title} `)
    );
  if (!matches.length) {
    return { docId: null, status: 'missing' as const };
  }

  // Prefer the longest exact title mention so a note called "Launch Plan" is
  // not made ambiguous by another accessible note called merely "Plan".
  const longestTitleLength = Math.max(
    ...matches.map(candidate => candidate.title.length)
  );
  const matchingDocIds = new Set(
    matches
      .filter(candidate => candidate.title.length === longestTitleLength)
      .map(candidate => candidate.docId)
  );
  if (matchingDocIds.size !== 1) {
    return { docId: null, status: 'ambiguous' as const };
  }

  const [docId] = matchingDocIds;
  return docId
    ? { docId, status: 'resolved' as const }
    : { docId: null, status: 'missing' as const };
}

function localOnnxActionNeedsExistingDocument(
  intent: ReturnType<typeof actionIntent>
) {
  return (
    intent === 'append_database_rows' ||
    intent === 'replace_selection' ||
    intent === 'insert_markdown' ||
    intent === 'create_mindmap'
  );
}

function localOnnxActionCanResolveNamedDocument(
  intent: ReturnType<typeof actionIntent>
) {
  return (
    intent === 'append_database_rows' ||
    intent === 'insert_markdown' ||
    intent === 'create_mindmap'
  );
}

function localOnnxTargetTitleHint(content: string) {
  const normalized = content.trim().replace(/\s+/g, ' ');
  const locatedTitle =
    /\b(?:to|in|into|inside|within|on)\s+(?:the\s+)?(.{1,240}?)\s+(?:note|document|doc|page)\b/i.exec(
      normalized
    )?.[1];
  if (locatedTitle?.trim()) {
    return locatedTitle.trim().replace(/^["“`]|["”`]$/g, '');
  }

  return /["“`]([^"”`]{1,240})["”`]/.exec(normalized)?.[1]?.trim() ?? null;
}

function localOnnxTargetRefusalMessage(
  intent: ReturnType<typeof actionIntent>,
  status: 'ambiguous' | 'missing' | 'resolved' | undefined
) {
  if (intent === 'replace_selection') {
    return 'I did not create an edit proposal because selected-text replacement requires an open note with an active selection. Nothing was changed.';
  }
  if (status === 'ambiguous') {
    return 'I did not create an edit proposal because more than one accessible note matches that title. Open the intended note or specify a unique title. Nothing was changed.';
  }
  return 'I did not create an edit proposal because I could not safely identify one accessible target note. Open the note or mention its exact title. Nothing was changed.';
}

async function workspaceAgentContext(input: {
  config: AiBackendConfig;
  session: CopilotSession;
}) {
  const search = await workspaceContext(input);
  if (!input.config.toolsEnabled || !input.config.workspaceSearchToolEnabled) {
    return { ...search, targetResolution: null };
  }

  const user = latestUserMessage(input.session);
  const query = user ? messageContent(user).trim() : '';
  const mode = localWorkspaceDocumentMode(query);
  const intent = actionIntent(query);
  const shouldResolveNamedTarget =
    !input.session.docId && localOnnxActionCanResolveNamedDocument(intent);
  if (!query || (mode === 'search' && !shouldResolveNamedTarget)) {
    return { ...search, targetResolution: null };
  }

  const targetTitleHint = shouldResolveNamedTarget
    ? localOnnxTargetTitleHint(query)
    : null;
  const listing = await listWorkspaceDocuments(input.config, {
    limit: 20,
    query: targetTitleHint ?? undefined,
    userId: 'local-user',
    workspaceId: input.session.workspaceId,
  });
  const documentList =
    mode !== 'search' && listing.documents.length
      ? [
          `Available Nota documents (${listing.documents.length} shown of ${listing.total}):`,
          ...listing.documents.map(
            document => `- ${document.title} [source: ${document.sourceRef}]`
          ),
        ].join('\n')
      : mode !== 'search'
        ? 'No readable Nota documents are currently indexed.'
        : '';

  let targetResolution = shouldResolveNamedTarget
    ? resolveLocalOnnxTargetDocument(query, [
        ...listing.documents,
        ...search.results,
      ])
    : null;
  if (
    targetResolution?.status === 'resolved' &&
    listing.total > listing.documents.length
  ) {
    // The access-scoped title query was truncated, so a duplicate exact title
    // may exist outside the returned page. Refuse instead of guessing.
    targetResolution = { docId: null, status: 'ambiguous' };
  }

  let canonicalDocument = '';
  if (mode === 'read' || targetResolution?.status === 'resolved') {
    const normalizedQuery = query.toLowerCase();
    const titleMatch = [...listing.documents]
      .sort((left, right) => right.title.length - left.title.length)
      .find(document =>
        normalizedQuery.includes(document.title.trim().toLowerCase())
      );
    const candidateDocIds = (
      targetResolution?.status === 'resolved'
        ? [targetResolution.docId]
        : [
            ...search.results.slice(0, 5).map(result => result.docId),
            titleMatch?.docId,
          ]
    ).filter(
      (docId, index, all): docId is string =>
        !!docId && all.indexOf(docId) === index
    );
    for (const docId of candidateDocIds) {
      try {
        const result = await readWorkspaceDocument(input.config, {
          docId,
          userId: 'local-user',
          workspaceId: input.session.workspaceId,
        });
        canonicalDocument = [
          `Canonical Nota document: ${result.document.title} [source: ${result.document.sourceRef}]`,
          truncate(result.document.markdown, 10000),
        ].join('\n\n');
        break;
      } catch {
        if (
          targetResolution?.status === 'resolved' &&
          docId === targetResolution.docId
        ) {
          targetResolution = { docId: null, status: 'missing' };
        }
        // Search snippets and the readable document list remain useful when a
        // stale index result cannot be opened as a canonical Nota document.
      }
    }
  }

  return {
    ...search,
    context: [search.context, documentList, canonicalDocument]
      .filter(Boolean)
      .join('\n\n'),
    targetResolution,
  };
}

function workspaceSearchStreamObject(input: {
  query: string;
  results: WorkspaceSearchResult[];
  searchType: string;
  sessionId: string;
}): StreamObject {
  return {
    args: { query: input.query },
    result: {
      results: input.results,
      searchType: input.searchType,
    },
    toolCallId: `preflight-search-${input.sessionId}`,
    toolName: 'search_nota_workspace',
    type: 'tool-result',
  };
}

export function isWholeDocumentClearRequest(content: string) {
  const lower = content.toLowerCase();
  const destructiveAdviceOnly =
    /\b(?:should|can|could)\s+(?:i|we)\b|\bshould\s+you\b|\bwould\s+it\b|\b(?:whether|if)\s+(?:i|we)\s+should\b|\bdo you think\b/.test(
      lower
    );
  const destructiveActionNegated =
    /\b(?:do not|don't|never|without)\s+(?:remove|rmeove|remvoe|delete|clear|wipe|erase)\b/.test(
      lower
    );
  return (
    !destructiveAdviceOnly &&
    !destructiveActionNegated &&
    /\b(remove|rmeove|remvoe|delete|clear|wipe|erase)\b/.test(lower) &&
    /\b(all this text|this text|previous content|current content|content|document|doc|page|note|body|everything|it|this|that)\b/.test(
      lower
    )
  );
}

export function actionIntent(content: string) {
  if (isWholeDocumentClearRequest(content)) {
    return null;
  }
  const lower = content.toLowerCase();
  const selectionMentioned =
    /\b(selected markdown|selected text|selection|highlighted(?: text)?)\b/.test(
      lower
    );
  if (
    selectionMentioned &&
    /\b(replace|rewrite|revise|edit|change|transform|polish|shorten|expand)\b/.test(
      lower
    )
  ) {
    return 'replace_selection' as const;
  }
  if (/\b(mind ?map|brainstorm map)\b/.test(lower)) {
    return 'create_mindmap' as const;
  }
  if (/\b(task list|todo|to-do|action items|checklist)\b/.test(lower)) {
    return 'create_task_list' as const;
  }
  if (
    /\b(database|table|tracker|kanban|crm|inventory|pipeline)\b/.test(lower) &&
    /\b(add|append|insert|new row|rows?)\b/.test(lower)
  ) {
    return 'append_database_rows' as const;
  }
  if (
    /\b(database|table|tracker|kanban|crm|inventory|pipeline)\b/.test(lower)
  ) {
    return 'create_database' as const;
  }
  if (/\b(insert|add|append|put)\b/.test(lower)) {
    return 'insert_markdown' as const;
  }
  if (
    /\b(create|make|draft|write|new)\b/.test(lower) &&
    /\b(note|page|doc)\b/.test(lower)
  ) {
    return 'create_note' as const;
  }
  return null;
}

export function localInsertPosition(content: string) {
  const lower = content.toLowerCase();
  if (
    /\b(selected markdown|selected text|selection|highlighted(?: text)?)\b/.test(
      lower
    )
  ) {
    return 'selection' as const;
  }
  if (
    /\b(at (?:the )?(?:start|beginning|top)|before everything|prepend)\b/.test(
      lower
    )
  ) {
    return 'start' as const;
  }
  return 'end' as const;
}

function titleFromMarkdown(markdown: string, fallback: string) {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  if (heading) {
    return truncate(heading, 120);
  }
  const firstLine = markdown
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*#\s]+/, '').trim())
    .find(Boolean);
  return truncate(firstLine || fallback || 'Generated note', 120);
}

export function localOnnxMutationMarkdown(assistantText: string) {
  const withoutSources = assistantText
    .replace(/\r?\n\r?\nSources:\r?\n[\s\S]*$/i, '')
    .trim();
  const fencedBlocks = [
    ...withoutSources.matchAll(
      /```(?:markdown|md)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/gi
    ),
  ];
  const fenceMarkers = withoutSources.match(/```/g)?.length ?? 0;
  if (fencedBlocks.length !== 1 || fenceMarkers !== 2) {
    return null;
  }

  return fencedBlocks[0]?.[1]?.trim() || null;
}

export function buildLocalOnnxActionProposal(input: {
  assistantText: string;
  session: CopilotSession;
  targetDocId?: string | null;
  userContent: string;
}): AgentActionProposal | null {
  const intent = actionIntent(input.userContent);
  const markdown = localOnnxMutationMarkdown(input.assistantText);
  if (!intent) {
    return null;
  }

  if (!markdown) {
    return null;
  }

  let proposal: AgentActionProposal | null = null;
  const title = titleFromMarkdown(markdown, input.userContent);
  const sessionDocId = input.session.docId?.trim() || null;
  const targetDocId = sessionDocId || input.targetDocId?.trim() || null;
  if (intent === 'create_note') {
    proposal = {
      markdown,
      title,
      type: 'create_note',
    };
  } else if (intent === 'create_task_list') {
    proposal = {
      docId: sessionDocId ?? undefined,
      markdown,
      title,
      type: 'create_task_list',
    };
  } else if (intent === 'create_database') {
    proposal = {
      markdown,
      title,
      type: 'create_database',
    };
  } else if (intent === 'append_database_rows' && targetDocId) {
    proposal = {
      docId: targetDocId,
      markdown,
      type: 'append_database_rows',
    };
  } else if (intent === 'replace_selection' && sessionDocId) {
    proposal = {
      docId: sessionDocId,
      markdown,
      type: 'replace_selection',
    };
  } else if (intent === 'insert_markdown' && targetDocId) {
    proposal = {
      docId: targetDocId,
      markdown,
      position: localInsertPosition(input.userContent),
      type: 'insert_markdown',
    };
  } else if (intent === 'create_mindmap' && targetDocId) {
    proposal = {
      docId: targetDocId,
      markdown,
      type: 'create_mindmap',
    };
  }

  return proposal;
}

function createMarkdownActionProposal(input: {
  assistantText: string;
  session: CopilotSession;
  targetDocId?: string | null;
  userContent: string;
}) {
  const intent = actionIntent(input.userContent);
  const proposal = buildLocalOnnxActionProposal(input);
  if (!intent || !proposal) {
    return null;
  }

  return createActionProposal({
    proposal,
    reason: `The model prepared a ${intent.replace(/_/g, ' ')} proposal.`,
    sessionId: input.session.sessionId,
    workspaceId: input.session.workspaceId,
  });
}

function createLocalActionStreamObject(
  proposal: ReturnType<typeof createActionProposal>
) {
  return {
    args: {
      reason: proposal.reason,
      workspaceId: proposal.workspaceId,
    },
    result: { proposal, requiresApproval: true },
    toolCallId: `local-action-${proposal.id}`,
    toolName: 'propose_nota_action',
    type: 'tool-result' as const,
  };
}

function imagePromptFor(
  promptName: string,
  userContent: string,
  hasInputImage: boolean
) {
  const content = userContent.trim();
  const subject = content || 'Use the provided context as the subject.';

  switch (promptName) {
    case 'Convert to Clay style':
      return hasInputImage
        ? `Transform the attached image into a polished clay-render style. Preserve the main composition and subject.\n\nContext:\n${subject}`
        : `Create a polished clay-render style image from this prompt:\n${subject}`;
    case 'Convert to Pixel style':
      return hasInputImage
        ? `Transform the attached image into pixel-art style. Preserve the subject and recognizable composition.\n\nContext:\n${subject}`
        : `Create a pixel-art image from this prompt:\n${subject}`;
    case 'Convert to Sketch style':
      return hasInputImage
        ? `Transform the attached image into a clean hand-drawn sketch. Preserve the subject and composition.\n\nContext:\n${subject}`
        : `Create a clean hand-drawn sketch from this prompt:\n${subject}`;
    case 'Convert to Anime style':
      return hasInputImage
        ? `Transform the attached image into anime illustration style. Preserve the subject and composition.\n\nContext:\n${subject}`
        : `Create an anime illustration from this prompt:\n${subject}`;
    case 'Convert to sticker':
      return hasInputImage
        ? `Turn the attached image into a crisp sticker-style asset with a clean outline and transparent or simple background where possible.\n\nContext:\n${subject}`
        : `Create a crisp sticker-style asset with a clean outline from this prompt:\n${subject}`;
    case 'Upscale image':
      return hasInputImage
        ? `Enhance the attached image so it is clearer, sharper, and cleaner. Preserve the original subject and composition.\n\nContext:\n${subject}`
        : `Create a clear, high-detail image from this prompt:\n${subject}`;
    case 'Remove background':
      return hasInputImage
        ? `Remove the background from the attached image. Preserve the foreground subject cleanly with transparent or plain background where possible.\n\nContext:\n${subject}`
        : `Create a foreground subject on a transparent or plain background from this prompt:\n${subject}`;
    case 'Generate image':
    default:
      return `Generate a high-quality image for this Nota workspace prompt:\n${subject}`;
  }
}

function imagePrompt(session: ReturnType<CopilotStore['requireSession']>) {
  const user = latestUserMessage(session);
  const content = user ? messageContent(user) : '';
  const attachments = user?.attachments ?? [];
  const text = imagePromptFor(
    session.promptName,
    content,
    attachments.length > 0
  );

  return attachments.length
    ? {
        text,
        images: attachments,
      }
    : text;
}

function assertHostedImageProviderAvailable(
  config: AiBackendConfig,
  provider: string
) {
  if (provider === 'openai' && !config.openaiApiKey) {
    throw new Error(
      'Image generation is set to OpenAI, but OPENAI_API_KEY is missing.'
    );
  }
  if (provider === 'google' && !config.googleApiKey) {
    throw new Error(
      'Image generation is set to Google, but GOOGLE_GENERATIVE_AI_API_KEY is missing.'
    );
  }
}

async function assertLocalProviderAvailable(
  config: AiBackendConfig,
  modelId?: string,
  usage: 'image' | 'text' = 'text'
) {
  if (modelId && isLocalOnnxTextModel(modelId)) {
    if (usage === 'image') {
      throw new Error('Local ONNX text models cannot generate images.');
    }
    await assertLocalOnnxTextReady(config, modelId);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const baseUrl = config.localBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.localApiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Local AI provider responded with HTTP ${response.status}`
      );
    }
  } catch (error) {
    throw new Error(
      `Local AI provider is not available at ${config.localBaseUrl}. Start Ollama or set NOTA_AI_PROVIDER/NOTA_AI_MODEL for a hosted provider. ${errorMessage(
        error
      )}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createImageHandler({
  config,
  models,
  store,
}: {
  config: AiBackendConfig;
  models: AiModelRouter;
  store: CopilotStore;
}) {
  return async (req: Request, res: Response) => {
    const sessionId = normalizeSessionId(req.params.sessionId);
    if (!sessionId) {
      writeSseHead(res);
      writeSseError(res, 400, 'Missing AI chat session id.');
      return;
    }

    writeSseHead(res);

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const session = store.getSession(sessionId);
      if (!session) {
        writeSseError(res, 404, 'AI chat session not found.');
        return;
      }
      const selected = models.selectImage(
        typeof req.query.modelId === 'string' ? req.query.modelId : undefined
      );
      if (selected.provider === 'local') {
        await assertLocalProviderAvailable(config, selected.modelId, 'image');
      } else {
        assertHostedImageProviderAvailable(config, selected.provider);
      }

      const seed =
        typeof req.query.seed === 'string' &&
        Number.isFinite(Number(req.query.seed))
          ? Number(req.query.seed)
          : undefined;
      const result = await generateImage({
        model: selected.model,
        prompt: imagePrompt(session),
        n: 1,
        seed,
        maxRetries: 0,
        abortSignal: controller.signal,
      });
      const image = result.image;
      const dataUrl = `data:${image.mediaType};base64,${image.base64}`;

      writeSse(res, 'attachment', dataUrl);
      store.appendAssistantMessage(
        sessionId,
        `Generated image with ${selected.modelId}.`,
        [],
        [dataUrl]
      );
      res.end();
    } catch (error) {
      writeSseError(res, 500, errorMessage(error));
    }
  };
}

export function createStreamHandler({
  config,
  models,
  store,
}: {
  config: AiBackendConfig;
  models: AiModelRouter;
  store: CopilotStore;
}) {
  return async (req: Request, res: Response) => {
    const sessionId = normalizeSessionId(req.params.sessionId);
    if (!sessionId) {
      writeSseHead(res);
      writeSseError(res, 400, 'Missing AI chat session id.');
      return;
    }

    writeSseHead(res);

    const disconnect = abortTextRequestOnDisconnect(req, res);
    const { signal } = disconnect.controller;
    let toolContext: NotaToolContext | null = null;
    try {
      const session = store.getSession(sessionId);
      if (!session) {
        writeSseError(res, 404, 'AI chat session not found.');
        return;
      }
      const requestedModelId =
        typeof req.query.modelId === 'string' ? req.query.modelId : undefined;
      const selected = models.select(requestedModelId);
      const reasoning = resolveReasoning(selected, req.query.reasoning);
      const retry = req.query.retry === 'true';
      const requestConfig = configForRequestWorkspaceAccess(
        config,
        workspaceContentAccessForRequest(req.query.toolsConfig)
      );
      const user = latestUserMessage(session);
      if (
        selected.runtime === 'local-onnx' &&
        user?.attachments.some(attachment =>
          attachment.startsWith('data:image/')
        )
      ) {
        throw new Error(
          'This local ONNX model is text-only. Remove the image attachments or choose a vision-capable model.'
        );
      }
      await assertBackendTextModelAvailable(config, selected);
      if (signal.aborted) return;
      if (retry) store.removeLastAssistantMessage(sessionId);
      const userContent = user ? messageContent(user) : '';
      const intent = config.toolsEnabled ? actionIntent(userContent) : null;
      if (config.toolsEnabled && isWholeDocumentClearRequest(userContent)) {
        const assistantText =
          'Clearing an entire note is disabled until Nota can restore it safely. I can help replace selected content or prepare a new note instead.';
        writeSse(res, 'message', assistantText);
        if (signal.aborted) return;
        store.appendAssistantMessage(sessionId, assistantText, [
          { type: 'text-delta', textDelta: assistantText },
        ]);
        res.end();
        return;
      }
      const preflightContext = await workspaceAgentContext({
        config: requestConfig,
        session,
      });
      if (signal.aborted) return;
      if (
        localOnnxActionNeedsExistingDocument(intent) &&
        !session.docId &&
        preflightContext.targetResolution?.status !== 'resolved'
      ) {
        const assistantText = localOnnxTargetRefusalMessage(
          intent,
          preflightContext.targetResolution?.status
        );
        writeSse(res, 'message', assistantText);
        if (signal.aborted) return;
        store.appendAssistantMessage(sessionId, assistantText, [
          { type: 'text-delta', textDelta: assistantText },
        ]);
        res.end();
        return;
      }
      toolContext = await createNotaToolContext(requestConfig, {
        sessionId: session.sessionId,
        userId: 'local-user',
        workspaceId: session.workspaceId,
      });
      const tools = toolContext.tools;
      const streamObjects: StreamObject[] = [];
      if (preflightContext.results.length) {
        const searchObject = workspaceSearchStreamObject({
          query: preflightContext.query,
          results: preflightContext.results,
          searchType: preflightContext.searchType,
          sessionId,
        });
        streamObjects.push(searchObject);
        writeSse(res, 'message', JSON.stringify(searchObject));
      }
      if (signal.aborted) return;
      const systemWithPreflightContext = [
        systemPromptWithTools(session.promptName, !!tools),
        session.docId || preflightContext.targetResolution?.docId
          ? `The target Nota document id supplied for this request is ${session.docId || preflightContext.targetResolution?.docId}.`
          : '',
        preflightContext.context
          ? [
              'Use the local Nota workspace context below when relevant.',
              'Cite the specific source references that support the answer using [source: docId#blockId].',
              preflightContext.context,
            ].join('\n\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const toolMaxSteps = config.toolMaxSteps;
      const result = streamText({
        abortSignal: signal,
        model: selected.model,
        maxRetries: 0,
        maxOutputTokens: 12_000,
        ...reasoning.sdk,
        system: systemWithPreflightContext,
        messages: toModelMessages(session, selected.runtime),
        tools,
        stopWhen: tools ? stepCountIs(toolMaxSteps + 1) : undefined,
        prepareStep: tools
          ? ({ stepNumber }) =>
              stepNumber >= toolMaxSteps
                ? {
                    activeTools: [],
                    toolChoice: 'none',
                    instructions: [
                      systemWithPreflightContext,
                      'The tool round budget is exhausted. Give your final answer using the information already gathered. If the task is incomplete, explain what remains. Do not claim changes were applied unless their results confirm it.',
                    ].join('\n\n'),
                  }
                : undefined
          : undefined,
      });

      let assistantText = '';
      for await (const part of result.fullStream) {
        if (signal.aborted) return;
        if (part.type === 'text-delta') {
          assistantText += part.text;
          writeSse(res, 'message', part.text);
        }
        if (part.type === 'reasoning-delta') {
          const reasoningObject: StreamObject = {
            type: 'reasoning',
            textDelta: part.text,
          };
          streamObjects.push(reasoningObject);
          writeSse(res, 'message', JSON.stringify(reasoningObject));
        }
        if (part.type === 'tool-call') {
          const toolCallObject: StreamObject = {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: toRecord(part.input),
          };
          streamObjects.push(toolCallObject);
          writeSse(res, 'message', JSON.stringify(toolCallObject));
        }
        if (part.type === 'tool-result' || part.type === 'tool-error') {
          const toolResultObject: StreamObject = {
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: toRecord(part.input),
            result:
              part.type === 'tool-error'
                ? { status: 'error', error: errorMessage(part.error) }
                : part.output,
          };
          streamObjects.push(toolResultObject);
          writeSse(res, 'message', JSON.stringify(toolResultObject));
        }
        if (part.type === 'error') {
          if (signal.aborted) return;
          if (assistantText.trim() || streamObjects.length) {
            store.appendAssistantMessage(sessionId, assistantText, [
              { type: 'text-delta', textDelta: assistantText },
              ...streamObjects,
            ]);
          }
          writeSse(
            res,
            'error',
            JSON.stringify({
              status: 500,
              message: errorMessage(part.error),
            })
          );
          res.end();
          return;
        }
      }
      if (signal.aborted) return;

      // Keep the exact fenced-Markdown fallback for models that answer with
      // proposed content instead of calling the proposal tool. Both routes use
      // the same approval store, and an actual tool proposal is never duplicated.
      const hasProposal = streamObjects.some(
        part =>
          part.type === 'tool-result' && part.toolName === 'propose_nota_action'
      );
      if (intent && !hasProposal) {
        const proposal = createMarkdownActionProposal({
          assistantText,
          session,
          targetDocId: preflightContext.targetResolution?.docId,
          userContent,
        });
        if (proposal) {
          const object = createLocalActionStreamObject(proposal);
          streamObjects.push(object);
          writeSse(res, 'message', JSON.stringify(object));
        } else {
          const notice =
            '\n\nNo edit proposal was created because the model did not call the proposal tool or return exactly one safe Markdown content block. Nothing was changed.';
          assistantText += notice;
          writeSse(res, 'message', notice);
        }
      }
      if (signal.aborted) return;
      if (shouldAppendSourceSection(assistantText, preflightContext.results)) {
        const sourceSection = formatSourceSection(preflightContext.results);
        assistantText += sourceSection;
        writeSse(res, 'message', sourceSection);
      }

      if (signal.aborted) return;
      store.appendAssistantMessage(sessionId, assistantText, [
        { type: 'text-delta', textDelta: assistantText },
        ...streamObjects,
      ]);
      res.end();
    } catch (error) {
      if (signal.aborted) return;
      writeSseError(res, 500, errorMessage(error));
    } finally {
      disconnect.cleanup();
      await toolContext?.close();
    }
  };
}

export function createUnsupportedSseHandler(message: string) {
  return (_req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    writeSse(
      res,
      'error',
      JSON.stringify({
        status: 501,
        message,
      })
    );
    res.end();
  };
}
