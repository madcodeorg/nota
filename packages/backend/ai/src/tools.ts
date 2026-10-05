import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { createActionProposal } from './actions';
import type { AiBackendConfig } from './config';
import { loadMcpToolContext, type McpStatus } from './mcp';
import {
  listWorkspaceDocuments,
  readWorkspaceDocument,
  searchWorkspace,
} from './workspace-search';

const execFileAsync = promisify(execFile);

const MAX_TOOL_OUTPUT = 20000;
const MAX_WEB_TEXT = 24000;
const ALLOWED_SHELL_COMMANDS = new Set([
  'cat',
  'git',
  'head',
  'ls',
  'pwd',
  'rg',
  'tail',
  'wc',
]);
const ALLOWED_GIT_SUBCOMMANDS = new Set([
  'diff',
  'grep',
  'log',
  'ls-files',
  'show',
  'status',
]);
const FORBIDDEN_RG_OPTIONS = ['--hostname-bin', '--pre', '--pre-glob'] as const;
const FORBIDDEN_GIT_OPTIONS = [
  '--ext-diff',
  '--ext-grep',
  '--open-files-in-pager',
  '--output',
  '--show-signature',
  '--textconv',
] as const;

function truncate(value: string, max = MAX_TOOL_OUTPUT) {
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseShellCommand(command: string) {
  if (/[;&|<>`$\\\n\r]/.test(command)) {
    throw new Error('Shell metacharacters are not allowed.');
  }

  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return parts.map(part => part.replace(/^['"]|['"]$/g, ''));
}

export function assertSafeShellArgs(parts: string[]) {
  const command = parts[0];
  if (!command || !ALLOWED_SHELL_COMMANDS.has(command)) {
    throw new Error(
      `Command not allowed. Allowed commands: ${[
        ...ALLOWED_SHELL_COMMANDS,
      ].join(', ')}`
    );
  }

  if (command === 'git') {
    const subcommand = parts[1];
    if (!subcommand || !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      throw new Error(
        `Git subcommand not allowed. Allowed subcommands: ${[
          ...ALLOWED_GIT_SUBCOMMANDS,
        ].join(', ')}`
      );
    }
  }

  const matchesOption = (arg: string, option: string) =>
    arg === option || arg.startsWith(`${option}=`);
  const optionTerminator = parts.indexOf('--');
  const optionParts = parts.slice(
    command === 'git' ? 2 : 1,
    optionTerminator >= 0 ? optionTerminator : undefined
  );
  if (
    command === 'rg' &&
    optionParts.some(arg =>
      FORBIDDEN_RG_OPTIONS.some(option => matchesOption(arg, option))
    )
  ) {
    throw new Error(
      'Ripgrep preprocessors and external hostname commands are not allowed.'
    );
  }
  if (
    command === 'rg' &&
    optionParts.some(
      arg =>
        arg === '-f' || arg.startsWith('-f') || matchesOption(arg, '--file')
    )
  ) {
    throw new Error('External pattern-file operands are not allowed.');
  }
  if (
    command === 'git' &&
    optionParts.some(
      arg =>
        FORBIDDEN_GIT_OPTIONS.some(option => matchesOption(arg, option)) ||
        arg === '--help' ||
        arg === '-h' ||
        ((parts[1] === 'log' || parts[1] === 'show') &&
          (matchesOption(arg, '--format') || matchesOption(arg, '--pretty'))) ||
        (parts[1] === 'grep' && (arg === '-O' || arg.startsWith('-O')))
    )
  ) {
    throw new Error(
      'Git external commands, pagers, signatures, and output files are not allowed.'
    );
  }
  if (
    command === 'git' &&
    optionParts.some(arg => {
      if (
        parts[1] === 'grep' &&
        (arg === '-f' || arg.startsWith('-f') || matchesOption(arg, '--file'))
      ) {
        return true;
      }
      if (
        parts[1] === 'ls-files' &&
        (arg === '-X' ||
          arg.startsWith('-X') ||
          matchesOption(arg, '--exclude-from'))
      ) {
        return true;
      }
      return (
        (parts[1] === 'diff' || parts[1] === 'log' || parts[1] === 'show') &&
        (arg === '-O' || arg.startsWith('-O'))
      );
    })
  ) {
    throw new Error('External file operands are not allowed.');
  }
  if (
    command === 'wc' &&
    parts.slice(1).some(arg => matchesOption(arg, '--files0-from'))
  ) {
    throw new Error('wc file-list inputs are not allowed.');
  }
  if (
    command === 'rg' &&
    optionParts.some(
      arg =>
        arg === '--follow' ||
        arg === '--search-zip' ||
        (/^-[^-]/.test(arg) && /[Lz]/.test(arg.slice(1)))
    )
  ) {
    throw new Error(
      'Following symbolic links and spawning archive decompressors are not allowed.'
    );
  }
  if (
    command === 'ls' &&
    parts
      .slice(1)
      .some(
        arg =>
          arg === '--dereference' ||
          arg.startsWith('--dereference-command-line') ||
          (/^-[^-]/.test(arg) && /[HL]/.test(arg.slice(1)))
      )
  ) {
    throw new Error('Following symbolic links is not allowed.');
  }

  for (const arg of parts.slice(1)) {
    const optionValue = arg.startsWith('-') ? arg.split('=', 2)[1] : undefined;
    const pathValues = optionValue === undefined ? [arg] : [arg, optionValue];
    if (
      pathValues.some(
        value =>
          value === '..' || value.includes('../') || value.includes('..\\')
      )
    ) {
      throw new Error('Parent-directory traversal is not allowed.');
    }
    if (pathValues.some(value => path.isAbsolute(value))) {
      throw new Error('Absolute paths are not allowed.');
    }
  }
}

function parseIpv4Address(address: string) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return octets.every(Number.isFinite)
    ? (octets as [number, number, number, number])
    : null;
}

function isForbiddenIpv4Address(address: string) {
  const octets = parseIpv4Address(address);
  if (!octets) return false;
  const [first, second, third, fourth] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254 && third === 169 && fourth === 254)
  );
}

function parseIpv6Address(address: string) {
  const ipv4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)?.[1];
  let normalized = address;
  if (ipv4) {
    const octets = parseIpv4Address(ipv4);
    if (!octets) return null;
    normalized = address.replace(
      ipv4,
      `${((octets[0] << 8) | octets[1]).toString(16)}:${(
        (octets[2] << 8) |
        octets[3]
      ).toString(16)}`
    );
  }

  const compressed = normalized.split('::');
  if (compressed.length > 2) return null;

  const left = compressed[0] ? compressed[0].split(':').filter(Boolean) : [];
  const right = compressed[1] ? compressed[1].split(':').filter(Boolean) : [];
  const missing = compressed.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ];
  if (parts.length !== 8) return null;

  const hextets = parts.map(part => {
    if (!/^[\da-f]{1,4}$/i.test(part)) return Number.NaN;
    return Number.parseInt(part, 16);
  });
  return hextets.every(Number.isFinite)
    ? (hextets as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ])
    : null;
}

function ipv4FromLast32Bits(hextets: [number, number]) {
  return [
    hextets[0] >> 8,
    hextets[0] & 255,
    hextets[1] >> 8,
    hextets[1] & 255,
  ].join('.');
}

export function isForbiddenWebCrawlAddress(address: string) {
  const normalized = address.toLowerCase();
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isForbiddenIpv4Address(normalized);
  }

  if (ipVersion !== 6) {
    return false;
  }

  const hextets = parseIpv6Address(normalized);
  if (!hextets) {
    return false;
  }

  const isAllZero = hextets.every(hextet => hextet === 0);
  const isLoopback =
    hextets.slice(0, 7).every(hextet => hextet === 0) && hextets[7] === 1;
  if (isAllZero || isLoopback) {
    return true;
  }

  const isIpv4Mapped =
    hextets.slice(0, 5).every(hextet => hextet === 0) && hextets[5] === 0xffff;
  const isIpv4Compatible = hextets.slice(0, 6).every(hextet => hextet === 0);
  if (
    (isIpv4Mapped || isIpv4Compatible) &&
    isForbiddenIpv4Address(ipv4FromLast32Bits([hextets[6], hextets[7]]))
  ) {
    return true;
  }

  return (hextets[0] & 0xfe00) === 0xfc00 || (hextets[0] & 0xffc0) === 0xfe80;
}

function normalizedUrlHostname(url: URL) {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

export async function assertPublicWebCrawlUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https URLs are allowed.');
  }

  const port = url.port;
  if (
    port &&
    !(
      (url.protocol === 'http:' && port === '80') ||
      (url.protocol === 'https:' && port === '443')
    )
  ) {
    throw new Error('Only default http and https ports are allowed.');
  }

  const hostname = normalizedUrlHostname(url);
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length) {
    throw new Error(`Could not resolve URL host: ${hostname}`);
  }

  const blocked = addresses.find(result =>
    isForbiddenWebCrawlAddress(result.address)
  );
  if (blocked) {
    throw new Error(
      `URL host resolves to a private address: ${blocked.address}`
    );
  }
}

async function workspaceRoot(config: AiBackendConfig) {
  return realpath(config.workspaceRoot);
}

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function safeCwd(root: string, cwd?: string) {
  if (!cwd) return root;
  if (path.isAbsolute(cwd) || cwd === '..' || cwd.includes('../')) {
    throw new Error('Tool cwd must stay inside the Nota workspace.');
  }

  const resolved = path.resolve(root, cwd);
  if (!isInsideRoot(root, resolved)) {
    throw new Error('Tool cwd must stay inside the Nota workspace.');
  }
  const canonical = await realpath(resolved);
  if (!isInsideRoot(root, canonical)) {
    throw new Error('Tool cwd must stay inside the Nota workspace.');
  }
  return canonical;
}

async function safeExecutableSearchPath(root: string) {
  const fallback =
    process.platform === 'win32'
      ? [
          process.env.SYSTEMROOT
            ? path.join(process.env.SYSTEMROOT, 'System32')
            : '',
        ]
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const entries = (process.env.PATH?.split(path.delimiter) ?? fallback).filter(
    entry => entry && path.isAbsolute(entry)
  );
  const safeEntries: string[] = [];
  for (const entry of entries) {
    try {
      const canonical = await realpath(entry);
      if (!isInsideRoot(root, canonical) && !safeEntries.includes(canonical)) {
        safeEntries.push(canonical);
      }
    } catch {
      // Ignore missing or inaccessible PATH entries.
    }
  }
  return safeEntries;
}

async function safeShellExecutable(
  command: string,
  root: string,
  searchPaths: string[]
) {
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
      : [''];
  for (const directory of searchPaths) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        const canonical = await realpath(candidate);
        await access(canonical, constants.X_OK);
        if (!isInsideRoot(root, canonical)) {
          return canonical;
        }
      } catch {
        // Try the next trusted PATH entry.
      }
    }
  }
  throw new Error(`Allowed shell command is not installed: ${command}`);
}

async function assertExistingShellPathsInsideRoot(
  root: string,
  cwd: string,
  args: string[]
) {
  for (const arg of args) {
    const optionValue = arg.startsWith('-') ? arg.split('=', 2)[1] : undefined;
    const candidate = optionValue ?? (arg.startsWith('-') ? null : arg);
    if (!candidate || candidate === '-' || /^\d+$/.test(candidate)) {
      continue;
    }
    try {
      const canonical = await realpath(path.resolve(cwd, candidate));
      if (!isInsideRoot(root, canonical)) {
        throw new Error(
          'Shell command paths must stay inside the Nota workspace.'
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
    }
  }
}

export async function executeSafeShellCommand(input: {
  command: string;
  cwd?: string;
  root: string;
}) {
  const root = await realpath(input.root);
  const parts = parseShellCommand(input.command);
  assertSafeShellArgs(parts);
  const commandCwd = await safeCwd(root, input.cwd);
  const [file, ...args] = parts;
  await assertExistingShellPathsInsideRoot(root, commandCwd, args);
  const executableSearchPaths = await safeExecutableSearchPath(root);
  const executable = await safeShellExecutable(
    file,
    root,
    executableSearchPaths
  );

  const gitArgs = (() => {
    if (file !== 'git') return args;
    const [subcommand, ...subcommandArgs] = args;
    const forcedSafeOptions =
      subcommand === 'diff'
        ? ['--no-ext-diff', '--no-textconv']
        : subcommand === 'show' || subcommand === 'log'
          ? ['--no-ext-diff', '--no-textconv', '--no-show-signature']
          : subcommand === 'grep'
            ? ['--no-ext-grep', '--no-textconv']
            : [];
    return [subcommand, ...forcedSafeOptions, ...subcommandArgs];
  })();
  const hardenedArgs =
    file === 'rg'
      ? ['--no-config', ...args]
      : file === 'git'
        ? [
            '--no-pager',
            '-c',
            'core.fsmonitor=false',
            '-c',
            'diff.external=',
            '-c',
            'log.showSignature=false',
            '-c',
            'pager.diff=false',
            ...gitArgs,
          ]
        : args;

  const environment: NodeJS.ProcessEnv = {
    COMSPEC: process.env.COMSPEC,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    LANG: process.env.LANG ?? 'C',
    LC_ALL: process.env.LC_ALL ?? 'C',
    PAGER: 'cat',
    PATH: executableSearchPaths.join(path.delimiter),
    PATHEXT: process.env.PATHEXT,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    TZ: process.env.TZ,
    WINDIR: process.env.WINDIR,
  };

  try {
    const { stdout, stderr } = await execFileAsync(executable, hardenedArgs, {
      cwd: commandCwd,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env: environment,
    });
    return {
      cwd: commandCwd,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
    };
  } catch (error) {
    const typed = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      cwd: commandCwd,
      exitCode: typed.code ?? 1,
      stdout: truncate(typed.stdout ?? ''),
      stderr: truncate(typed.stderr || typed.message || ''),
    };
  }
}

function requireWorkspaceToolScope(context?: {
  userId?: string | null;
  workspaceId?: string | null;
}) {
  const userId = context?.userId?.trim();
  const workspaceId = context?.workspaceId?.trim();
  if (!userId || !workspaceId) {
    throw new Error(
      'A Nota user and workspace session are required for workspace tools.'
    );
  }
  return { userId, workspaceId };
}

function requireActionProposalScope(context?: {
  sessionId?: string | null;
  workspaceId?: string | null;
}) {
  const sessionId = context?.sessionId?.trim();
  const workspaceId = context?.workspaceId?.trim();
  if (!sessionId || !workspaceId) {
    throw new Error(
      'A trusted Nota workspace and chat session are required for action proposals.'
    );
  }
  return { sessionId, workspaceId };
}

export interface NotaToolContext {
  close(): Promise<void>;
  mcpStatus: McpStatus[];
  tools: ToolSet | undefined;
}

export async function createNotaToolContext(
  config: AiBackendConfig,
  context?: {
    sessionId?: string | null;
    userId?: string | null;
    workspaceId?: string | null;
  }
): Promise<NotaToolContext> {
  const builtinTools = createBuiltinNotaTools(config, context);
  const mcpContext = await loadMcpToolContext(config);
  const tools = {
    ...builtinTools,
    ...(config.toolsEnabled && config.mcpEnabled
      ? {
          list_mcp_tools: tool({
            description:
              'List configured MCP tools. Read tools may be called directly. Gated write tools must be proposed with propose_nota_action using type run_mcp_tool.',
            inputSchema: z.object({}),
            execute: async () => ({
              servers: mcpContext.status,
            }),
          }),
        }
      : {}),
    ...mcpContext.tools,
  };

  return {
    close: mcpContext.close,
    mcpStatus: mcpContext.status,
    tools: Object.keys(tools).length ? tools : undefined,
  };
}

function createBuiltinNotaTools(
  config: AiBackendConfig,
  context?: {
    sessionId?: string | null;
    userId?: string | null;
    workspaceId?: string | null;
  }
): ToolSet | undefined {
  if (!config.toolsEnabled) return undefined;

  const tools: ToolSet = {};

  tools.propose_nota_action = tool({
    description:
      'Create a pending Nota workspace action proposal for user approval. Use this when the user asks AI to create notes, insert text, replace selected content, create mindmaps, create task lists, create database/table documents, or append rows to an existing database. Whole-document clearing is unavailable. This tool does not apply changes directly.',
    inputSchema: z.object({
      reason: z
        .string()
        .max(1000)
        .optional()
        .describe('Short reason shown to the user for approval.'),
      proposal: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('create_note'),
          title: z.string().min(1).max(240),
          markdown: z.string().min(1).max(100000),
        }),
        z.object({
          type: z.literal('insert_markdown'),
          docId: z.string().min(1).max(500),
          markdown: z.string().min(1).max(100000),
          position: z.enum(['start', 'end', 'selection']).optional(),
        }),
        z.object({
          type: z.literal('replace_selection'),
          docId: z.string().min(1).max(500),
          markdown: z.string().min(1).max(100000),
        }),
        z.object({
          type: z.literal('create_mindmap'),
          docId: z.string().min(1).max(500),
          markdown: z.string().min(1).max(100000),
        }),
        z.object({
          type: z.literal('create_task_list'),
          title: z.string().min(1).max(240),
          markdown: z.string().min(1).max(100000),
          docId: z.string().min(1).max(500).optional(),
        }),
        z.object({
          type: z.literal('create_database'),
          title: z.string().min(1).max(240),
          markdown: z
            .string()
            .min(1)
            .max(100000)
            .describe(
              'Markdown table or structured Markdown representing the requested database.'
            ),
        }),
        z.object({
          type: z.literal('append_database_rows'),
          docId: z
            .string()
            .min(1)
            .max(500)
            .describe('Target Nota document id containing the database.'),
          databaseBlockId: z
            .string()
            .min(1)
            .max(500)
            .optional()
            .describe(
              'Optional affine:database block id. If omitted, Nota uses the first database block in the document.'
            ),
          markdown: z
            .string()
            .min(1)
            .max(100000)
            .describe('Markdown table or row list to append to the database.'),
        }),
        z.object({
          type: z.literal('run_mcp_tool'),
          toolName: z
            .string()
            .min(1)
            .max(180)
            .describe('Namespaced gated MCP tool name from AI Settings.'),
          args: z
            .unknown()
            .default({})
            .describe('JSON arguments to pass after user approval.'),
        }),
      ]),
    }),
    execute: async ({ proposal, reason }) => {
      const stored = createActionProposal({
        proposal,
        reason,
        ...requireActionProposalScope(context),
      });
      return {
        proposal: stored,
        requiresApproval: true,
        nextStep:
          'Show this proposal to the user and apply it only through the Nota frontend/editor transaction path after approval.',
      };
    },
  });

  if (config.workspaceSearchToolEnabled) {
    tools.list_nota_documents = tool({
      description:
        'List documents the current user can read in the current Nota workspace. Use this to discover exact document ids before reading a document. This never lists documents from another workspace or private documents the current user cannot access.',
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe('Optional title or document-id filter.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum number of readable documents to return.'),
      }),
      execute: async ({ limit, query }) => {
        return listWorkspaceDocuments(config, {
          ...requireWorkspaceToolScope(context),
          limit,
          query,
        });
      },
    });

    tools.read_nota_document = tool({
      description:
        'Read the complete canonical Markdown for one exact document that the current user can access in the current Nota workspace. Use list_nota_documents or search_nota_workspace first when the document id is unknown. This never reads repository files or inaccessible Nota documents.',
      inputSchema: z.object({
        docId: z
          .string()
          .min(1)
          .max(500)
          .describe('Exact Nota document id from list or search results.'),
      }),
      execute: async ({ docId }) => {
        return readWorkspaceDocument(config, {
          ...requireWorkspaceToolScope(context),
          docId,
        });
      },
    });

    tools.search_nota_workspace = tool({
      description:
        'Search readable content in the current Nota workspace plus local project context using local neural embeddings when available, with hashed-vector and lexical fallback plus source citations. Workspace results are always restricted to the current user and session workspace.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe('Text or regex to search for.'),
        glob: z
          .string()
          .max(160)
          .optional()
          .describe('Optional ripgrep glob, for example docs/**/*.md.'),
      }),
      execute: async ({ query, glob }) => {
        return searchWorkspace(config, {
          ...requireWorkspaceToolScope(context),
          glob,
          query,
        });
      },
    });
  }

  if (config.webCrawlToolEnabled) {
    tools.web_crawl = tool({
      description:
        'Fetch one public http/https page and return readable text for summarizing into Nota notes. Do not use for private credentials or non-web protocols.',
      inputSchema: z.object({
        url: z.string().url().describe('Public http or https URL to crawl.'),
      }),
      execute: async ({ url }) => {
        const parsed = new URL(url);
        await assertPublicWebCrawlUrl(parsed);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(parsed, {
            headers: {
              'User-Agent': 'NotaAI/0.26 local workspace crawler',
            },
            redirect: 'manual',
            signal: controller.signal,
          });
          const contentType = response.headers.get('content-type') ?? '';
          const body = await response.text();
          const text = contentType.includes('text/html')
            ? stripHtml(body)
            : body;

          return {
            url: parsed.toString(),
            status: response.status,
            contentType,
            text: truncate(text, MAX_WEB_TEXT),
          };
        } finally {
          clearTimeout(timeout);
        }
      },
    });
  }

  if (config.shellToolEnabled) {
    tools.nota_shell = tool({
      description:
        'Run a strictly allowlisted read-only shell command inside the Nota workspace root. Allowed commands are cat, git diff/grep/log/ls-files/show/status, head, ls, pwd, rg, tail, and wc. No writes, network commands, pipes, redirects, or parent paths.',
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .max(300)
          .describe(
            'Read-only command, for example "rg ai docs" or "ls docs".'
          ),
        cwd: z
          .string()
          .max(160)
          .optional()
          .describe('Optional relative cwd inside the Nota workspace.'),
      }),
      execute: async ({ command, cwd }) => {
        const root = await workspaceRoot(config);
        return executeSafeShellCommand({ command, cwd, root });
      },
    });
  }

  return Object.keys(tools).length ? tools : undefined;
}
