import type { AiBackendConfig } from './config';
import {
  type McpAuthConfig,
  type McpServerState,
  type McpStatus,
  parseMcpServerEntry,
  readMcpServerEntries,
} from './mcp';
import { hasMcpOAuthTokens } from './mcp-oauth';

export type McpSecretRef = { hasValue: boolean; name: string };

export type McpServerView = {
  auth:
    | { type: 'none' }
    | { hasToken: boolean; type: 'bearer' }
    | { hasValue: boolean; headerName: string; type: 'header' }
    | {
        clientId?: string;
        connected: boolean;
        hasClientSecret: boolean;
        scopes?: string;
        type: 'oauth';
      };
  connection:
    | { headers: McpSecretRef[]; type: 'http' | 'sse'; url: string }
    | { args: string[]; command: string; env: McpSecretRef[]; type: 'stdio' };
  description?: string;
  enabled: boolean;
  icon?: string;
  name: string;
  status: {
    blockedToolNames: string[];
    error?: string;
    state: McpServerState;
    toolNames: string[];
  };
};

export class McpServerRequestError extends Error {
  constructor(
    readonly statusCode: 400 | 404,
    message: string
  ) {
    super(message);
  }
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ICON_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
// Data URL length: a 10 KB PNG (the UI limit) is about 13.7 KB in base64.
const MAX_ICON_LENGTH = 16 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_DESCRIPTION_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new McpServerRequestError(400, message);
}

function notFound(name: string): never {
  throw new McpServerRequestError(404, `MCP server not found: ${name}`);
}

function secretRefs(values?: Record<string, string>): McpSecretRef[] {
  return Object.entries(values ?? {}).map(([name, value]) => ({
    hasValue: !!value,
    name,
  }));
}

function authView(
  settingsPath: string,
  name: string,
  auth: McpAuthConfig
): McpServerView['auth'] {
  switch (auth.type) {
    case 'bearer':
      return { hasToken: !!auth.token, type: 'bearer' };
    case 'header':
      return {
        hasValue: !!auth.value,
        headerName: auth.headerName,
        type: 'header',
      };
    case 'oauth':
      return {
        ...(auth.clientId ? { clientId: auth.clientId } : {}),
        connected: hasMcpOAuthTokens(settingsPath, name),
        hasClientSecret: !!auth.clientSecret,
        ...(auth.scopes ? { scopes: auth.scopes } : {}),
        type: 'oauth',
      };
    default:
      return { type: 'none' };
  }
}

function statusView(
  config: AiBackendConfig,
  enabled: boolean,
  status: McpStatus | undefined
): McpServerView['status'] {
  if (!config.toolsEnabled || !config.mcpEnabled || !enabled) {
    return { blockedToolNames: [], state: 'disabled', toolNames: [] };
  }
  if (!status) {
    return {
      blockedToolNames: [],
      error: 'Server status is unavailable.',
      state: 'error',
      toolNames: [],
    };
  }
  return {
    blockedToolNames: status.blockedToolNames ?? [],
    ...(status.error ? { error: status.error } : {}),
    state: status.state ?? (status.error ? 'error' : 'ready'),
    toolNames: status.toolNames,
  };
}

function toMcpServerView(
  config: AiBackendConfig,
  name: string,
  raw: Record<string, unknown>,
  status: McpStatus | undefined
): McpServerView | null {
  const server = parseMcpServerEntry(name, raw);
  if (!server) {
    return null;
  }
  return {
    auth:
      server.type === 'stdio'
        ? { type: 'none' }
        : authView(config.settingsPath, name, server.auth),
    connection:
      server.type === 'stdio'
        ? {
            args: server.args ?? [],
            command: server.command,
            env: secretRefs(server.env),
            type: 'stdio',
          }
        : {
            headers: secretRefs(server.headers),
            type: server.type,
            url: server.url,
          },
    ...(typeof raw.description === 'string' && raw.description
      ? { description: raw.description }
      : {}),
    enabled: server.enabled,
    ...(typeof raw.icon === 'string' && raw.icon ? { icon: raw.icon } : {}),
    name,
    status: statusView(config, server.enabled, status),
  };
}

export function listMcpServerViews(
  config: AiBackendConfig,
  status: McpStatus[]
): { error?: string; servers: McpServerView[] } {
  let entries: Record<string, Record<string, unknown>>;
  try {
    entries = readMcpServerEntries(config.mcpConfig);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      servers: [],
    };
  }
  const statusByName = new Map(status.map(item => [item.name, item]));
  return {
    servers: Object.entries(entries).flatMap(
      ([name, raw]) =>
        toMcpServerView(config, name, raw, statusByName.get(name)) ?? []
    ),
  };
}

export function getMcpServerView(
  config: AiBackendConfig,
  name: string,
  status: McpStatus[]
) {
  const view = listMcpServerViews(config, status).servers.find(
    server => server.name === name
  );
  return view ?? notFound(name);
}

export function getMcpServer(config: AiBackendConfig, name: string) {
  let entries: Record<string, Record<string, unknown>>;
  try {
    entries = readMcpServerEntries(config.mcpConfig);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const raw = Object.hasOwn(entries, name) ? entries[name] : undefined;
  return (raw && parseMcpServerEntry(name, raw)) || notFound(name);
}

function readEntries(rawConfig: string) {
  try {
    return readMcpServerEntries(rawConfig);
  } catch (error) {
    fail(
      `Fix the MCP config before editing servers: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`Invalid ${label}.`);
  return value.trim();
}

function readSecretList(
  value: unknown,
  previous: Record<string, string> | undefined,
  options: { label: string; pattern: RegExp; singleLine: boolean }
) {
  if (value === undefined) return {};
  if (!Array.isArray(value)) fail(`Invalid ${options.label} list.`);
  const result = new Map<string, string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string') {
      fail(`Invalid ${options.label}.`);
    }
    const name = item.name.trim();
    if (!options.pattern.test(name)) {
      fail(`Invalid ${options.label} name: ${name || '(empty)'}`);
    }
    if (result.has(name)) fail(`Duplicate ${options.label}: ${name}`);
    if (item.value !== undefined && typeof item.value !== 'string') {
      fail(`Invalid ${options.label} value: ${name}`);
    }
    const secret =
      item.value ||
      (previous && Object.hasOwn(previous, name) ? previous[name] : '');
    if (!secret) fail(`Enter a value for ${options.label} ${name}.`);
    if (options.singleLine && /[\r\n]/.test(secret)) {
      fail(`The ${options.label} ${name} must be a single line.`);
    }
    result.set(name, secret);
  }
  return Object.fromEntries(result);
}

function singleLineSecret(value: string, label: string) {
  if (!value) fail(`Enter a ${label}.`);
  if (/[\r\n]/.test(value)) fail(`The ${label} must be a single line.`);
  return value;
}

function readAuthInput(value: unknown, previous: McpAuthConfig): McpAuthConfig {
  if (!isRecord(value)) fail('Choose how Nota authenticates to this server.');
  switch (value.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer': {
      const token =
        optionalString(value.token, 'bearer token') ||
        (previous.type === 'bearer' ? previous.token : '');
      return { token: singleLineSecret(token, 'bearer token'), type: 'bearer' };
    }
    case 'header': {
      const headerName = optionalString(value.headerName, 'header name') ?? '';
      if (!HEADER_NAME_PATTERN.test(headerName)) {
        fail(`Invalid header name: ${headerName || '(empty)'}`);
      }
      const headerValue =
        optionalString(value.value, 'header value') ||
        (previous.type === 'header' ? previous.value : '');
      return {
        headerName,
        type: 'header',
        value: singleLineSecret(headerValue, 'header value'),
      };
    }
    case 'oauth': {
      const clientId = optionalString(value.clientId, 'client ID') || undefined;
      const clientSecret = clientId
        ? optionalString(value.clientSecret, 'client secret') ||
          (previous.type === 'oauth' ? previous.clientSecret : undefined)
        : undefined;
      const scopes = optionalString(value.scopes, 'scopes') || undefined;
      return {
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
        ...(scopes ? { scopes } : {}),
        type: 'oauth',
      };
    }
    default:
      fail('Unsupported authentication type.');
  }
}

/**
 * Applies a server form submission to the stored config. Blank secrets keep
 * the stored value so the UI never needs to read secrets back.
 */
export function applyMcpServerInput(rawConfig: string, input: unknown) {
  if (!isRecord(input)) fail('Invalid MCP server.');
  const entries = readEntries(rawConfig);

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!NAME_PATTERN.test(name)) {
    fail(
      'Server names must start with a letter or number and use up to 64 letters, numbers, spaces, dots, dashes, or underscores.'
    );
  }
  if (
    input.originalName !== undefined &&
    typeof input.originalName !== 'string'
  ) {
    fail('Invalid original server name.');
  }
  const originalName = input.originalName;
  const previousRaw =
    originalName !== undefined && Object.hasOwn(entries, originalName)
      ? entries[originalName]
      : undefined;
  if (originalName !== undefined && !previousRaw) notFound(originalName);
  if (name !== originalName && Object.hasOwn(entries, name)) {
    fail(`An MCP server named "${name}" already exists.`);
  }
  const previous =
    originalName !== undefined && previousRaw
      ? parseMcpServerEntry(originalName, previousRaw)
      : null;

  const entry: Record<string, unknown> = {};

  const description =
    optionalString(input.description, 'description') ??
    (typeof previousRaw?.description === 'string'
      ? previousRaw.description
      : '');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`Descriptions can be up to ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (description) entry.description = description;

  const icon =
    optionalString(input.icon, 'icon') ??
    (typeof previousRaw?.icon === 'string' ? previousRaw.icon : '');
  if (icon) {
    if (icon.length > MAX_ICON_LENGTH || !ICON_PATTERN.test(icon)) {
      fail('The icon must be a small PNG image.');
    }
    entry.icon = icon;
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    fail('Invalid enabled value.');
  }
  entry.enabled = input.enabled ?? true;

  const connection = input.connection;
  if (!isRecord(connection)) fail('Choose how Nota connects to this server.');
  let auth: McpAuthConfig = { type: 'none' };

  if (connection.type === 'stdio') {
    const command = optionalString(connection.command, 'command') ?? '';
    if (!command) fail('Enter the command that starts this server.');
    if (
      connection.args !== undefined &&
      (!Array.isArray(connection.args) ||
        connection.args.some(arg => typeof arg !== 'string'))
    ) {
      fail('Arguments must be a list of strings.');
    }
    entry.command = command;
    entry.args = connection.args ?? [];
    if (previous?.type === 'stdio' && previous.cwd) entry.cwd = previous.cwd;
    const env = readSecretList(
      connection.env,
      previous?.type === 'stdio' ? previous.env : undefined,
      {
        label: 'environment variable',
        pattern: ENV_NAME_PATTERN,
        singleLine: false,
      }
    );
    if (Object.keys(env).length) entry.env = env;
  } else if (connection.type === 'http' || connection.type === 'sse') {
    const url = optionalString(connection.url, 'URL') ?? '';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      fail('Enter a valid server URL.');
    }
    // Plain http would send headers and tokens unencrypted, so it is only
    // accepted for servers on this machine.
    if (
      parsedUrl.protocol !== 'https:' &&
      !(
        parsedUrl.protocol === 'http:' && LOOPBACK_HOSTS.has(parsedUrl.hostname)
      )
    ) {
      fail(
        'Server URLs must start with https://. Plain http:// works only for localhost.'
      );
    }
    entry.type = connection.type;
    entry.url = url;
    const headers = readSecretList(
      connection.headers,
      previous && previous.type !== 'stdio' ? previous.headers : undefined,
      { label: 'header', pattern: HEADER_NAME_PATTERN, singleLine: true }
    );
    if (Object.keys(headers).length) entry.headers = headers;
    auth = readAuthInput(
      input.auth,
      previous && previous.type !== 'stdio' ? previous.auth : { type: 'none' }
    );
    if (auth.type !== 'none') entry.auth = auth;
  } else {
    fail('Unsupported connection type.');
  }

  const nextEntries =
    originalName === undefined
      ? [...Object.entries(entries), [name, entry] as const]
      : Object.entries(entries).map(([key, value]) =>
          key === originalName
            ? ([name, entry] as const)
            : ([key, value] as const)
        );

  // OAuth tokens belong to one server URL and client; anything else is stale.
  const keepAuth =
    auth.type === 'oauth' &&
    previous?.type !== 'stdio' &&
    previous?.auth.type === 'oauth' &&
    previous.url === entry.url &&
    previous.auth.clientId === auth.clientId;

  return {
    keepAuth,
    mcpConfig: writeEntries(rawConfig, Object.fromEntries(nextEntries)),
    name,
    originalName,
  };
}

export function removeMcpServer(rawConfig: string, name: string) {
  const entries = readEntries(rawConfig);
  if (!Object.hasOwn(entries, name)) notFound(name);
  return writeEntries(
    rawConfig,
    Object.fromEntries(Object.entries(entries).filter(([key]) => key !== name))
  );
}

/** Rewrites only the server map, keeping any other keys in the config. */
function writeEntries(rawConfig: string, servers: Record<string, unknown>) {
  const parsed: unknown = rawConfig.trim() ? JSON.parse(rawConfig) : {};
  const root = isRecord(parsed) ? parsed : {};
  let next: Record<string, unknown>;
  if (isRecord(root.mcpServers)) {
    next = { ...root, mcpServers: servers };
  } else if (isRecord(root.servers)) {
    next = { ...root, servers };
  } else {
    // A bare config keeps its servers at the top level; keep the other values.
    next = {
      ...Object.fromEntries(
        Object.entries(root).filter(([, value]) => !isRecord(value))
      ),
      mcpServers: servers,
    };
  }
  return JSON.stringify(next, null, 2);
}
