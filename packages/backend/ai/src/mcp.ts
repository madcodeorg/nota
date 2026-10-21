import { homedir } from 'node:os';
import path from 'node:path';

import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
  type OAuthClientProvider,
  UnauthorizedError,
} from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

import type { AiBackendConfig } from './config';
import { createMcpOAuthProvider } from './mcp-oauth';

export type McpAuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'header'; headerName: string; value: string }
  | {
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
      type: 'oauth';
    };

type McpServerConfig =
  | {
      args?: string[];
      command: string;
      cwd?: string;
      env?: Record<string, string>;
      type: 'stdio';
    }
  | {
      auth: McpAuthConfig;
      headers?: Record<string, string>;
      type: 'http' | 'sse';
      url: string;
    };

export type ParsedMcpServer = McpServerConfig & {
  enabled: boolean;
  name: string;
};

export type McpServerState =
  | 'auth-required'
  | 'disabled'
  | 'error'
  | 'gated'
  | 'ready';

export interface McpStatus {
  blockedToolNames?: string[];
  error?: string;
  name: string;
  state?: McpServerState;
  toolNames: string[];
  transport: 'http' | 'sse' | 'stdio' | 'unknown';
}

export interface McpToolContext {
  close(): Promise<void>;
  status: McpStatus[];
  tools: ToolSet;
}

type ExecutableTool = {
  execute?: (
    input: unknown,
    options: {
      messages: [];
      toolCallId: string;
    }
  ) => unknown;
};

type McpWriteToolMeta = {
  namespacedToolName: string;
  serverName: string;
  toolName: string;
};

type McpPoolState = {
  clients: MCPClient[];
  readTools: ToolSet;
  signature: string;
  status: McpStatus[];
  writeToolMeta: Map<string, McpWriteToolMeta>;
  writeTools: Map<string, ExecutableTool>;
};

export interface ApprovedMcpToolResult {
  namespacedToolName: string;
  result: unknown;
  serverName: string;
  toolName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeToolName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function toolText(toolName: string, toolDefinition: unknown) {
  const definition =
    toolDefinition && typeof toolDefinition === 'object'
      ? (toolDefinition as Record<string, unknown>)
      : {};
  const description =
    typeof definition.description === 'string' ? definition.description : '';
  return `${toolName} ${description}`.toLowerCase();
}

function annotationFlag(toolDefinition: unknown, name: string) {
  if (!isRecord(toolDefinition)) {
    return undefined;
  }
  const annotations = toolDefinition.annotations;
  if (!isRecord(annotations)) {
    return undefined;
  }
  return typeof annotations[name] === 'boolean' ? annotations[name] : undefined;
}

export function isGatedMcpWriteTool(toolName: string, toolDefinition: unknown) {
  const readOnlyHint = annotationFlag(toolDefinition, 'readOnlyHint');
  const destructiveHint = annotationFlag(toolDefinition, 'destructiveHint');

  // A destructive annotation is the strongest available safety signal. Some
  // servers incorrectly advertise both hints, so never let readOnlyHint make
  // an explicitly destructive tool available to autonomous chat.
  if (destructiveHint === true) {
    return true;
  }
  if (readOnlyHint === true) {
    return false;
  }
  if (readOnlyHint === false) {
    return true;
  }
  return isLikelyWriteMcpTool(toolName, toolDefinition);
}

export function isLikelyWriteMcpTool(
  toolName: string,
  toolDefinition: unknown
) {
  const text = toolText(toolName, toolDefinition);
  return /(?:^|[^a-z0-9])(?:add|append|apply|archive|assign|commit|create|delete|deploy|edit|execute|import|insert|merge|modify|move|open_pull_request|patch|post|publish|push|put|remove|rename|replace|run|save|send|set|submit|update|upload|write)(?:$|[^a-z0-9])/.test(
    text
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function readStringRecord(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return Object.fromEntries(entries);
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

export function readMcpAuthConfig(value: unknown): McpAuthConfig {
  if (!isRecord(value)) {
    return { type: 'none' };
  }
  switch (value.type) {
    case 'bearer':
      return {
        token: typeof value.token === 'string' ? value.token : '',
        type: 'bearer',
      };
    case 'header':
      return {
        headerName:
          typeof value.headerName === 'string' ? value.headerName : '',
        type: 'header',
        value: typeof value.value === 'string' ? value.value : '',
      };
    case 'oauth':
      return {
        clientId: readOptionalString(value.clientId),
        clientSecret: readOptionalString(value.clientSecret),
        scopes: readOptionalString(value.scopes),
        type: 'oauth',
      };
    default:
      return { type: 'none' };
  }
}

/** Raw server entries keyed by name, including UI metadata the loader ignores. */
export function readMcpServerEntries(
  rawConfig: string
): Record<string, Record<string, unknown>> {
  if (!rawConfig.trim()) {
    return {};
  }

  const parsed = JSON.parse(rawConfig) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('MCP config must be a JSON object.');
  }

  const serverRoot =
    isRecord(parsed.mcpServers) || isRecord(parsed.servers)
      ? ((parsed.mcpServers ?? parsed.servers) as Record<string, unknown>)
      : parsed;

  return Object.fromEntries(
    Object.entries(serverRoot).filter(
      (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])
    )
  );
}

export function parseMcpServerEntry(
  name: string,
  rawServer: Record<string, unknown>
): ParsedMcpServer | null {
  const enabled = rawServer.enabled !== false;

  if (typeof rawServer.command === 'string') {
    return {
      args: readStringArray(rawServer.args),
      command: rawServer.command,
      cwd: typeof rawServer.cwd === 'string' ? rawServer.cwd : undefined,
      enabled,
      env: readStringRecord(rawServer.env),
      name,
      type: 'stdio',
    };
  }

  if (
    typeof rawServer.url === 'string' &&
    (rawServer.type === 'http' || rawServer.type === 'sse')
  ) {
    return {
      auth: readMcpAuthConfig(rawServer.auth),
      enabled,
      headers: readStringRecord(rawServer.headers),
      name,
      type: rawServer.type,
      url: rawServer.url,
    };
  }

  return null;
}

function parseMcpConfig(rawConfig: string): ParsedMcpServer[] {
  return Object.entries(readMcpServerEntries(rawConfig)).flatMap(
    ([name, rawServer]) => parseMcpServerEntry(name, rawServer) ?? []
  );
}

function remoteHeaders(
  config: Extract<McpServerConfig, { type: 'http' | 'sse' }>
) {
  const headers = { ...config.headers };
  if (config.auth.type === 'bearer' && config.auth.token) {
    headers.Authorization = `Bearer ${config.auth.token}`;
  }
  if (config.auth.type === 'header' && config.auth.headerName) {
    headers[config.auth.headerName] = config.auth.value;
  }
  return headers;
}

function createTransport(
  config: McpServerConfig,
  authProvider?: OAuthClientProvider
) {
  if (config.type !== 'stdio') {
    return {
      authProvider,
      headers: remoteHeaders(config),
      type: config.type,
      url: config.url,
    } as const;
  }

  return new Experimental_StdioMCPTransport({
    args: config.args?.map(expandHomePath),
    command: config.command,
    cwd: config.cwd && expandHomePath(config.cwd),
    env: config.env,
  });
}

/** Child processes are spawned without a shell, so `~` is never expanded. */
export function expandHomePath(value: string) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

const MCP_CONNECT_TIMEOUT_MS = 30_000;

function mcpPoolSignature(config: AiBackendConfig) {
  return JSON.stringify({
    enabled: config.toolsEnabled && config.mcpEnabled,
    mcpConfig: config.mcpConfig,
  });
}

function emptyPool(signature: string): McpPoolState {
  return {
    clients: [],
    readTools: {},
    signature,
    status: [],
    writeToolMeta: new Map(),
    writeTools: new Map(),
  };
}

function namespacedToolName(serverName: string, toolName: string) {
  return `mcp_${sanitizeToolName(serverName)}_${sanitizeToolName(toolName)}`;
}

function definitionsByName(definitions: ListToolsResult) {
  return new Map(definitions.tools.map(tool => [tool.name, tool]));
}

async function closeMcpPool(pool: McpPoolState) {
  await Promise.allSettled(pool.clients.map(client => client.close()));
}

async function buildMcpPool(
  config: AiBackendConfig,
  signature: string
): Promise<McpPoolState> {
  if (!config.toolsEnabled || !config.mcpEnabled) {
    return emptyPool(signature);
  }

  let servers: ParsedMcpServer[];
  try {
    servers = parseMcpConfig(config.mcpConfig);
  } catch (error) {
    return {
      ...emptyPool(signature),
      status: [
        {
          error: error instanceof Error ? error.message : String(error),
          name: 'mcp-config',
          state: 'error',
          toolNames: [],
          transport: 'unknown',
        },
      ],
    };
  }

  const pool = emptyPool(signature);
  // Servers connect in parallel so one slow or hung server cannot hold up the
  // others, and each gets a time limit.
  const parts = await Promise.all(
    servers.map(server => connectMcpServerWithTimeout(config, server))
  );
  for (const part of parts) {
    pool.clients.push(...part.clients);
    Object.assign(pool.readTools, part.readTools);
    pool.status.push(...part.status);
    for (const [name, tool] of part.writeTools) pool.writeTools.set(name, tool);
    for (const [name, meta] of part.writeToolMeta) {
      pool.writeToolMeta.set(name, meta);
    }
  }
  return pool;
}

async function connectMcpServer(
  config: AiBackendConfig,
  server: ParsedMcpServer,
  onTransport: (transport: ReturnType<typeof createTransport>) => void
): Promise<McpPoolState> {
  const pool = emptyPool('');
  if (!server.enabled) {
    pool.status.push({
      blockedToolNames: [],
      name: server.name,
      state: 'disabled',
      toolNames: [],
      transport: server.type,
    });
    return pool;
  }

  const authProvider =
    server.type !== 'stdio' && server.auth.type === 'oauth'
      ? createMcpOAuthProvider({
          auth: server.auth,
          name: server.name,
          settingsPath: config.settingsPath,
        })
      : undefined;

  try {
    if (authProvider && !(await authProvider.tokens())) {
      pool.status.push(authRequiredStatus(server));
      return pool;
    }

    const transport = createTransport(server, authProvider);
    onTransport(transport);
    const client = await createMCPClient({
      clientName: 'nota-ai-backend',
      transport,
    });
    pool.clients.push(client);

    const definitions = await client.listTools();
    const toolDefinitions = definitionsByName(definitions);
    const serverTools = client.toolsFromDefinitions(definitions);
    const exposedToolNames: string[] = [];
    const blockedToolNames: string[] = [];

    for (const [toolName, toolDefinition] of toolDefinitions) {
      const namespaced = namespacedToolName(server.name, toolName);
      const serverTool = serverTools[toolName];
      if (!serverTool) {
        continue;
      }
      const executable = serverTool as unknown as ExecutableTool;

      if (isGatedMcpWriteTool(toolName, toolDefinition)) {
        blockedToolNames.push(namespaced);
        pool.writeTools.set(namespaced, executable);
        pool.writeToolMeta.set(namespaced, {
          namespacedToolName: namespaced,
          serverName: server.name,
          toolName,
        });
        continue;
      }

      pool.readTools[namespaced] = serverTool;
      exposedToolNames.push(namespaced);
    }

    pool.status.push({
      blockedToolNames,
      name: server.name,
      state: blockedToolNames.length > 0 ? 'gated' : 'ready',
      toolNames: exposedToolNames,
      transport: server.type,
    });
  } catch (error) {
    if (
      authProvider &&
      (error instanceof UnauthorizedError ||
        !(await Promise.resolve(authProvider.tokens()).catch(() => null)))
    ) {
      pool.status.push(authRequiredStatus(server));
      return pool;
    }
    pool.status.push({
      blockedToolNames: [],
      error: error instanceof Error ? error.message : String(error),
      name: server.name,
      state: 'error',
      toolNames: [],
      transport: server.type,
    });
  }

  return pool;
}

async function connectMcpServerWithTimeout(
  config: AiBackendConfig,
  server: ParsedMcpServer
): Promise<McpPoolState> {
  let transport: ReturnType<typeof createTransport> | undefined;
  const attempt = connectMcpServer(config, server, created => {
    transport = created;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), MCP_CONNECT_TIMEOUT_MS);
  });
  const result = await Promise.race([attempt, timedOut]);
  clearTimeout(timer);
  if (result) {
    return result;
  }
  // A hung stdio server never finishes connecting, so stop its process here;
  // a connection that finishes after the deadline is closed as well.
  if (transport && 'close' in transport) {
    void transport.close().catch(() => {});
  }
  void attempt.then(closeMcpPool).catch(() => {});
  return {
    ...emptyPool(''),
    status: [
      {
        blockedToolNames: [],
        error: `Timed out after ${MCP_CONNECT_TIMEOUT_MS / 1000} seconds while connecting. Turn the server off and on to retry.`,
        name: server.name,
        state: 'error',
        toolNames: [],
        transport: server.type,
      },
    ],
  };
}

function authRequiredStatus(server: ParsedMcpServer): McpStatus {
  return {
    blockedToolNames: [],
    error: 'Sign in to connect this server.',
    name: server.name,
    state: 'auth-required',
    toolNames: [],
    transport: server.type,
  };
}

let activeMcpPool: {
  promise: Promise<McpPoolState>;
  signature: string;
} | null = null;

async function getMcpPool(config: AiBackendConfig) {
  const signature = mcpPoolSignature(config);
  if (activeMcpPool?.signature === signature) {
    return activeMcpPool.promise;
  }

  const previous = activeMcpPool;
  const promise = buildMcpPool(config, signature);
  activeMcpPool = { promise, signature };

  if (previous) {
    promise
      .then(() => previous.promise.then(closeMcpPool))
      .catch(() => previous.promise.then(closeMcpPool))
      .catch(() => {});
  }

  return promise;
}

export function resetMcpPool() {
  const previous = activeMcpPool;
  activeMcpPool = null;
  previous?.promise.then(closeMcpPool).catch(() => {});
}

export function getConfiguredMcpServers(config: AiBackendConfig): McpStatus[] {
  if (!config.mcpEnabled) {
    return [];
  }

  try {
    return parseMcpConfig(config.mcpConfig).map(server => ({
      name: server.name,
      toolNames: [],
      transport: server.type,
    }));
  } catch (error) {
    return [
      {
        error: error instanceof Error ? error.message : String(error),
        name: 'mcp-config',
        toolNames: [],
        transport: 'unknown',
      },
    ];
  }
}

export async function loadMcpToolContext(
  config: AiBackendConfig
): Promise<McpToolContext> {
  const pool = await getMcpPool(config);

  return {
    async close() {},
    status: pool.status,
    tools: pool.readTools,
  };
}

export async function executeApprovedMcpTool(
  config: AiBackendConfig,
  input: {
    args: unknown;
    namespacedToolName: string;
  }
): Promise<ApprovedMcpToolResult> {
  if (!config.toolsEnabled || !config.mcpEnabled) {
    throw new Error('MCP tools are disabled.');
  }

  const pool = await getMcpPool(config);
  if (pool.readTools[input.namespacedToolName]) {
    throw new Error(
      `MCP tool is not gated as a write tool: ${input.namespacedToolName}`
    );
  }

  const meta = pool.writeToolMeta.get(input.namespacedToolName);
  const executable = pool.writeTools.get(input.namespacedToolName);
  if (!meta || !executable) {
    throw new Error(`MCP tool not found: ${input.namespacedToolName}`);
  }
  if (typeof executable.execute !== 'function') {
    throw new Error(
      `MCP tool does not expose an executable handler: ${input.namespacedToolName}`
    );
  }

  return {
    namespacedToolName: meta.namespacedToolName,
    result: await executable.execute(input.args, {
      messages: [],
      toolCallId: `approved-${Date.now()}`,
    }),
    serverName: meta.serverName,
    toolName: meta.toolName,
  };
}
