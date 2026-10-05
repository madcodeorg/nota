import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
} from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

import type { AiBackendConfig } from './config';

type McpServerConfig =
  | {
      args?: string[];
      command: string;
      cwd?: string;
      env?: Record<string, string>;
      type?: 'stdio';
    }
  | {
      headers?: Record<string, string>;
      type: 'http' | 'sse';
      url: string;
    };

type ParsedMcpServer = McpServerConfig & { name: string };

export interface McpStatus {
  blockedToolNames?: string[];
  error?: string;
  name: string;
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

function parseMcpConfig(rawConfig: string): ParsedMcpServer[] {
  if (!rawConfig.trim()) {
    return [];
  }

  const parsed = JSON.parse(rawConfig) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('MCP config must be a JSON object.');
  }

  const serverRoot =
    isRecord(parsed.mcpServers) || isRecord(parsed.servers)
      ? ((parsed.mcpServers ?? parsed.servers) as Record<string, unknown>)
      : parsed;

  const servers: ParsedMcpServer[] = [];

  for (const [name, rawServer] of Object.entries(serverRoot)) {
    if (!isRecord(rawServer)) {
      continue;
    }

    if (typeof rawServer.command === 'string') {
      servers.push({
        args: readStringArray(rawServer.args),
        command: rawServer.command,
        cwd: typeof rawServer.cwd === 'string' ? rawServer.cwd : undefined,
        env: readStringRecord(rawServer.env),
        name,
        type: 'stdio',
      });
      continue;
    }

    if (
      typeof rawServer.url === 'string' &&
      (rawServer.type === 'http' || rawServer.type === 'sse')
    ) {
      servers.push({
        headers: readStringRecord(rawServer.headers),
        name,
        type: rawServer.type,
        url: rawServer.url,
      });
    }
  }

  return servers;
}

function createTransport(config: McpServerConfig) {
  if (config.type === 'http' || config.type === 'sse') {
    return {
      headers: config.headers,
      type: config.type,
      url: config.url,
    } as const;
  }

  if (config.type && config.type !== 'stdio') {
    throw new Error(`Unsupported MCP transport: ${config.type}`);
  }

  return new Experimental_StdioMCPTransport({
    args: config.args,
    command: config.command,
    cwd: config.cwd,
    env: config.env,
  });
}

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
          toolNames: [],
          transport: 'unknown',
        },
      ],
    };
  }

  const pool = emptyPool(signature);

  for (const server of servers) {
    try {
      const client = await createMCPClient({
        clientName: 'nota-ai-backend',
        transport: createTransport(server),
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
        toolNames: exposedToolNames,
        transport: server.type ?? 'stdio',
      });
    } catch (error) {
      pool.status.push({
        error: error instanceof Error ? error.message : String(error),
        name: server.name,
        toolNames: [],
        transport: server.type ?? 'stdio',
      });
    }
  }

  return pool;
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
      transport: server.type ?? 'stdio',
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
