export type McpSecretRef = { name: string; hasValue: boolean };

export type McpServerStatusState =
  | 'ready'
  | 'gated'
  | 'error'
  | 'auth-required'
  | 'disabled';

export type McpServerView = {
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  connection:
    | { type: 'http' | 'sse'; url: string; headers: McpSecretRef[] }
    | { type: 'stdio'; command: string; args: string[]; env: McpSecretRef[] };
  auth:
    | { type: 'none' }
    | { type: 'bearer'; hasToken: boolean }
    | { type: 'header'; headerName: string; hasValue: boolean }
    | {
        type: 'oauth';
        clientId?: string;
        hasClientSecret: boolean;
        scopes?: string;
        connected: boolean;
      };
  status: {
    state: McpServerStatusState;
    error?: string;
    toolNames: string[];
    blockedToolNames: string[];
  };
};

type McpNamedValue = { name: string; value?: string };

export type McpServerInput = {
  originalName?: string;
  name: string;
  description?: string;
  icon?: string;
  enabled?: boolean;
  connection:
    | { type: 'http' | 'sse'; url: string; headers?: McpNamedValue[] }
    | {
        type: 'stdio';
        command: string;
        args?: string[];
        env?: McpNamedValue[];
      };
  auth:
    | { type: 'none' }
    | { type: 'bearer'; token?: string }
    | { type: 'header'; headerName: string; value?: string }
    | {
        type: 'oauth';
        clientId?: string;
        clientSecret?: string;
        scopes?: string;
      };
};

export type McpServersResponse = {
  enabled: boolean;
  toolsEnabled: boolean;
  servers: McpServerView[];
  error?: string;
};

export type RegistryHeader = {
  name: string;
  description?: string;
  required: boolean;
  secret: boolean;
  value?: string;
};
export type RegistryEnv = {
  name: string;
  description?: string;
  required: boolean;
  secret: boolean;
  default?: string;
};
export type RegistryInstall =
  | {
      kind: 'remote';
      type: 'http' | 'sse';
      url: string;
      headers: RegistryHeader[];
    }
  | {
      kind: 'package';
      registryType: 'npm' | 'pypi' | 'oci';
      command: string;
      args: string[];
      env: RegistryEnv[];
    };
export type RegistryEntry = {
  name: string;
  title?: string;
  description: string;
  version: string;
  repositoryUrl?: string;
  websiteUrl?: string;
  icon?: string;
  installs: RegistryInstall[];
};
export type RegistryResponse = {
  servers: RegistryEntry[];
  nextCursor?: string;
};

async function request<T>(
  path: string,
  {
    method,
    body,
    signal,
  }: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal,
  });
  const text = await response.text();
  let payload: unknown = undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }
  if (!response.ok) {
    const error = (payload as { error?: unknown } | undefined)?.error;
    throw new Error(
      typeof error === 'string' && error
        ? error
        : `AI backend returned HTTP ${response.status}`
    );
  }
  return payload as T;
}

const serverPath = (name: string) =>
  `/api/ai/mcp/servers/${encodeURIComponent(name)}`;

export const mcpApi = {
  list: (signal?: AbortSignal) =>
    request<McpServersResponse>('/api/ai/mcp/servers', { signal }),
  save: (input: McpServerInput) =>
    request<{ server: McpServerView }>('/api/ai/mcp/servers', { body: input }),
  remove: (name: string) =>
    request<void>(serverPath(name), { method: 'DELETE' }),
  startOAuth: (name: string) =>
    request<{ url: string }>(`${serverPath(name)}/oauth/start`, {
      method: 'POST',
    }),
  disconnectOAuth: (name: string) =>
    request<void>(`${serverPath(name)}/oauth/disconnect`, { method: 'POST' }),
  setEnabled: (mcpEnabled: boolean) =>
    request<unknown>('/api/ai/settings', { body: { mcpEnabled } }),
  searchRegistry: (search: string, cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ search });
    if (cursor) params.set('cursor', cursor);
    return request<RegistryResponse>(`/api/ai/mcp/registry?${params}`, {
      signal,
    });
  },
};

function isHttpsOrLocalUrl(url: URL) {
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
}

export function validatedOAuthUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid sign-in URL.');
  const url = new URL(value);
  if (!isHttpsOrLocalUrl(url) || url.username || url.password) {
    throw new Error('Invalid sign-in URL.');
  }
  return url.href;
}

export const MCP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
export const MAX_ICON_BYTES = 10 * 1024;

export type McpAuthType = McpServerInput['auth']['type'];

export type McpRow = {
  name: string;
  value: string;
  /** A value is stored on the backend; blank keeps it. */
  hasValue?: boolean;
  /** Prefilled from the registry and not required; dropped when blank. */
  optional?: boolean;
  description?: string;
};

export type McpServerDraft = {
  originalName?: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  mode: 'remote' | 'stdio';
  url: string;
  transport: 'http' | 'sse';
  headers: McpRow[];
  command: string;
  args: string;
  env: McpRow[];
  authType: McpAuthType;
  token: string;
  hasToken: boolean;
  headerName: string;
  headerValue: string;
  hasHeaderValue: boolean;
  clientId: string;
  clientSecret: string;
  hasClientSecret: boolean;
  scopes: string;
};

export function emptyDraft(): McpServerDraft {
  return {
    name: '',
    description: '',
    icon: '',
    enabled: true,
    mode: 'remote',
    url: '',
    transport: 'http',
    headers: [],
    command: '',
    args: '',
    env: [],
    authType: 'none',
    token: '',
    hasToken: false,
    headerName: '',
    headerValue: '',
    hasHeaderValue: false,
    clientId: '',
    clientSecret: '',
    hasClientSecret: false,
    scopes: '',
  };
}

const savedRow = (ref: McpSecretRef): McpRow => ({
  name: ref.name,
  value: '',
  hasValue: ref.hasValue,
});

export function draftFromServer(server: McpServerView): McpServerDraft {
  const draft: McpServerDraft = {
    ...emptyDraft(),
    originalName: server.name,
    name: server.name,
    description: server.description ?? '',
    icon: server.icon ?? '',
    enabled: server.enabled,
  };
  const connection = server.connection;
  if (connection.type === 'stdio') {
    draft.mode = 'stdio';
    draft.command = connection.command;
    draft.args = connection.args.join('\n');
    draft.env = connection.env.map(savedRow);
  } else {
    draft.url = connection.url;
    draft.transport = connection.type;
    draft.headers = connection.headers.map(savedRow);
  }
  const auth = server.auth;
  draft.authType = auth.type;
  if (auth.type === 'bearer') draft.hasToken = auth.hasToken;
  if (auth.type === 'header') {
    draft.headerName = auth.headerName;
    draft.hasHeaderValue = auth.hasValue;
  }
  if (auth.type === 'oauth') {
    draft.clientId = auth.clientId ?? '';
    draft.hasClientSecret = auth.hasClientSecret;
    draft.scopes = auth.scopes ?? '';
  }
  return draft;
}

export function sanitizeServerName(value: string) {
  const name = value
    .replace(/[^A-Za-z0-9 _.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
    .trim();
  return MCP_NAME_PATTERN.test(name) ? name : 'MCP server';
}

// Registry values may be templates such as "{api_key}" that the user must fill in.
const fixedValue = (value?: string) =>
  value && !value.includes('{') ? value : '';

export function draftFromRegistry(
  entry: RegistryEntry,
  install: RegistryInstall
): McpServerDraft {
  const draft: McpServerDraft = {
    ...emptyDraft(),
    name: sanitizeServerName(
      entry.title || entry.name.split('/').pop() || entry.name
    ),
    description: entry.description,
  };
  if (install.kind === 'remote') {
    draft.url = install.url;
    draft.transport = install.type;
    const authHeader = install.headers.find(
      header => header.required && header.secret
    );
    if (authHeader) {
      const bearer =
        /^authorization$/i.test(authHeader.name) &&
        (!authHeader.value || /^bearer\s/i.test(authHeader.value));
      if (bearer) {
        draft.authType = 'bearer';
      } else {
        draft.authType = 'header';
        draft.headerName = authHeader.name;
      }
    }
    draft.headers = install.headers
      .filter(header => header !== authHeader)
      .map(header => ({
        name: header.name,
        value: header.secret ? '' : fixedValue(header.value),
        optional: !header.required,
        description: header.description,
      }));
  } else {
    draft.mode = 'stdio';
    draft.command = install.command;
    draft.args = install.args.join('\n');
    draft.env = install.env.map(env => ({
      name: env.name,
      value: env.secret ? '' : fixedValue(env.default),
      optional: !env.required,
      description: env.description,
    }));
  }
  return draft;
}

const splitArgs = (args: string) =>
  args
    .split('\n')
    .map(arg => arg.trim())
    .filter(Boolean);

function rowsProblem(rows: McpRow[], kind: string) {
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name && !value) continue;
    if (!name) return `Every ${kind} needs a name.`;
    if (!value && !row.hasValue && !row.optional)
      return `Enter a value for ${name}.`;
  }
  return undefined;
}

export function validateDraft(
  draft: McpServerDraft,
  existingNames: string[] = []
): { name?: string; form?: string } {
  const name = draft.name.trim();
  const problems: { name?: string; form?: string } = {};
  if (!name) {
    problems.name = 'Enter a name.';
  } else if (!MCP_NAME_PATTERN.test(name)) {
    problems.name =
      'Use up to 64 letters, numbers, spaces, dots, dashes, or underscores, starting with a letter or number.';
  } else if (name !== draft.originalName && existingNames.includes(name)) {
    problems.name = 'A server with this name already exists.';
  }
  if (draft.mode === 'stdio') {
    problems.form = !draft.command.trim()
      ? 'Enter a command.'
      : rowsProblem(draft.env, 'environment variable');
    return problems;
  }
  let validUrl = false;
  try {
    validUrl = isHttpsOrLocalUrl(new URL(draft.url.trim()));
  } catch {
    validUrl = false;
  }
  if (!validUrl) {
    problems.form =
      'Enter a server URL starting with https://. Plain http:// works only for localhost.';
  } else if (
    draft.authType === 'bearer' &&
    !draft.token.trim() &&
    !draft.hasToken
  ) {
    problems.form = 'Enter an API key.';
  } else if (draft.authType === 'header' && !draft.headerName.trim()) {
    problems.form = 'Enter a header name.';
  } else if (
    draft.authType === 'header' &&
    !draft.headerValue.trim() &&
    !draft.hasHeaderValue
  ) {
    problems.form = 'Enter a header value.';
  } else {
    problems.form = rowsProblem(draft.headers, 'header');
  }
  return problems;
}

function rowsToInput(rows: McpRow[]) {
  return rows
    .map(row => ({ ...row, name: row.name.trim(), value: row.value.trim() }))
    .filter(row => row.name && (row.value || row.hasValue || !row.optional))
    .map(row =>
      row.value ? { name: row.name, value: row.value } : { name: row.name }
    );
}

const optional = (value: string) => value.trim() || undefined;

export function draftToInput(draft: McpServerDraft): McpServerInput {
  const base = {
    ...(draft.originalName ? { originalName: draft.originalName } : {}),
    name: draft.name.trim(),
    description: draft.description.trim(),
    icon: draft.icon,
    enabled: draft.enabled,
  };
  if (draft.mode === 'stdio') {
    return {
      ...base,
      connection: {
        type: 'stdio',
        command: draft.command.trim(),
        args: splitArgs(draft.args),
        env: rowsToInput(draft.env),
      },
      auth: { type: 'none' },
    };
  }
  const connection = {
    type: draft.transport,
    url: draft.url.trim(),
    headers: rowsToInput(draft.headers),
  };
  switch (draft.authType) {
    case 'bearer':
      return {
        ...base,
        connection,
        auth: { type: 'bearer', token: optional(draft.token) },
      };
    case 'header':
      return {
        ...base,
        connection,
        auth: {
          type: 'header',
          headerName: draft.headerName.trim(),
          value: optional(draft.headerValue),
        },
      };
    case 'oauth':
      return {
        ...base,
        connection,
        auth: {
          type: 'oauth',
          clientId: optional(draft.clientId),
          clientSecret: optional(draft.clientSecret),
          scopes: optional(draft.scopes),
        },
      };
    default:
      return { ...base, connection, auth: { type: 'none' } };
  }
}

export const transportLabel = (type: 'http' | 'sse') =>
  type === 'sse' ? 'SSE (legacy)' : 'Streamable HTTP';

export function connectionSummary(connection: McpServerView['connection']) {
  if (connection.type === 'stdio') {
    return `Local command · ${[connection.command, ...connection.args].join(' ')}`;
  }
  return `${connection.type === 'sse' ? 'SSE' : 'Streamable HTTP'} · ${connection.url}`;
}

export function installTag(install: RegistryInstall) {
  if (install.kind === 'remote') return 'Remote';
  return { npm: 'npm', pypi: 'PyPI', oci: 'Docker' }[install.registryType];
}

export function installLabel(install: RegistryInstall) {
  if (install.kind === 'remote')
    return `Remote · ${transportLabel(install.type)}`;
  return `${installTag(install)} · ${[install.command, ...install.args].join(' ')}`;
}

export function sortedInstalls(entry: RegistryEntry) {
  return [
    ...entry.installs.filter(install => install.kind === 'remote'),
    ...entry.installs.filter(install => install.kind !== 'remote'),
  ];
}
