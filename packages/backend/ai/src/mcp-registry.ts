export type RegistryHeader = {
  description?: string;
  name: string;
  required: boolean;
  secret: boolean;
  value?: string;
};

export type RegistryEnv = {
  default?: string;
  description?: string;
  name: string;
  required: boolean;
  secret: boolean;
};

export type RegistryInstall =
  | {
      headers: RegistryHeader[];
      kind: 'remote';
      type: 'http' | 'sse';
      url: string;
    }
  | {
      args: string[];
      command: string;
      env: RegistryEnv[];
      kind: 'package';
      registryType: 'npm' | 'oci' | 'pypi';
    };

export type RegistryEntry = {
  description: string;
  icon?: string;
  installs: RegistryInstall[];
  name: string;
  repositoryUrl?: string;
  title?: string;
  version: string;
  websiteUrl?: string;
};

export const MCP_REGISTRY_URL =
  'https://registry.modelcontextprotocol.io/v0.1/servers';
const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official';
const REGISTRY_CACHE_TTL_MS = 5 * 60_000;
const REGISTRY_CACHE_LIMIT = 50;
const registryCache = new Map<
  string,
  { expiresAt: number; result: ReturnType<typeof mapRegistryResponse> }
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function mapHeaders(value: unknown): RegistryHeader[] {
  return records(value).flatMap(header => {
    const name = text(header.name);
    if (!name) return [];
    const description = text(header.description);
    const headerValue = text(header.value);
    return [
      {
        ...(description ? { description } : {}),
        name,
        required: header.isRequired === true,
        secret: header.isSecret === true,
        ...(headerValue ? { value: headerValue } : {}),
      },
    ];
  });
}

function mapEnv(value: unknown): RegistryEnv[] {
  return records(value).flatMap(variable => {
    const name = text(variable.name);
    if (!name) return [];
    const description = text(variable.description);
    const fallback = text(variable.default);
    return [
      {
        ...(fallback ? { default: fallback } : {}),
        ...(description ? { description } : {}),
        name,
        required: variable.isRequired === true,
        secret: variable.isSecret === true,
      },
    ];
  });
}

function positionalArguments(value: unknown) {
  return records(value).flatMap(argument =>
    argument.type === 'positional' && text(argument.value)
      ? [argument.value as string]
      : []
  );
}

function mapRemote(remote: Record<string, unknown>): RegistryInstall[] {
  const url = text(remote.url);
  const type =
    remote.type === 'streamable-http'
      ? 'http'
      : remote.type === 'sse'
        ? 'sse'
        : undefined;
  if (!url || !type) return [];
  return [{ headers: mapHeaders(remote.headers), kind: 'remote', type, url }];
}

function mapPackage(pkg: Record<string, unknown>): RegistryInstall[] {
  const identifier = text(pkg.identifier);
  const transport = isRecord(pkg.transport) ? pkg.transport : {};
  if (!identifier || transport.type !== 'stdio') return [];
  const version = text(pkg.version);
  const env = mapEnv(pkg.environmentVariables);
  const extraArgs = positionalArguments(pkg.packageArguments);

  switch (pkg.registryType) {
    case 'npm':
      return [
        {
          args: [
            '-y',
            version ? `${identifier}@${version}` : identifier,
            ...extraArgs,
          ],
          command: 'npx',
          env,
          kind: 'package',
          registryType: 'npm',
        },
      ];
    case 'pypi':
      return [
        {
          args: [
            version ? `${identifier}==${version}` : identifier,
            ...extraArgs,
          ],
          command: 'uvx',
          env,
          kind: 'package',
          registryType: 'pypi',
        },
      ];
    case 'oci':
      return [
        {
          args: [
            'run',
            '-i',
            '--rm',
            ...env.flatMap(variable => ['-e', variable.name]),
            identifier,
            ...extraArgs,
          ],
          command: 'docker',
          env,
          kind: 'package',
          registryType: 'oci',
        },
      ];
    default:
      return [];
  }
}

function mapServer(item: Record<string, unknown>): RegistryEntry[] {
  const meta = isRecord(item._meta) ? item._meta[OFFICIAL_META_KEY] : undefined;
  if (
    isRecord(meta) &&
    (meta.status === 'deprecated' || meta.status === 'deleted')
  ) {
    return [];
  }
  const server = isRecord(item.server) ? item.server : undefined;
  const name = text(server?.name);
  if (!server || !name) return [];

  const installs = [
    ...records(server.remotes).flatMap(mapRemote),
    ...records(server.packages).flatMap(mapPackage),
  ];
  if (!installs.length) return [];

  const title = text(server.title);
  const repositoryUrl = isRecord(server.repository)
    ? text(server.repository.url)
    : undefined;
  const websiteUrl = text(server.websiteUrl);
  const icon = records(server.icons)
    .map(icon => text(icon.src))
    .find(src => src?.startsWith('https://'));

  return [
    {
      description: text(server.description) ?? '',
      ...(icon ? { icon } : {}),
      installs,
      name,
      ...(repositoryUrl ? { repositoryUrl } : {}),
      ...(title ? { title } : {}),
      version: text(server.version) ?? '',
      ...(websiteUrl ? { websiteUrl } : {}),
    },
  ];
}

export function mapRegistryResponse(payload: unknown): {
  nextCursor?: string;
  servers: RegistryEntry[];
} {
  if (!isRecord(payload)) {
    throw new Error('The MCP Registry returned an invalid response.');
  }
  const nextCursor = isRecord(payload.metadata)
    ? text(payload.metadata.nextCursor)
    : undefined;
  return {
    ...(nextCursor ? { nextCursor } : {}),
    servers: records(payload.servers).flatMap(mapServer),
  };
}

export async function fetchRegistryServers(
  options: { cursor?: string; search?: string },
  fetchFn: typeof fetch = fetch
) {
  const url = new URL(MCP_REGISTRY_URL);
  url.searchParams.set('version', 'latest');
  url.searchParams.set('limit', '30');
  if (options.search) url.searchParams.set('search', options.search);
  if (options.cursor) url.searchParams.set('cursor', options.cursor);

  const key = url.toString();
  const cached = registryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  // The public registry search regularly takes 10-25 seconds to answer.
  const response = await fetchFn(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`The MCP Registry returned HTTP ${response.status}.`);
  }
  const result = mapRegistryResponse(await response.json());
  registryCache.set(key, {
    expiresAt: Date.now() + REGISTRY_CACHE_TTL_MS,
    result,
  });
  if (registryCache.size > REGISTRY_CACHE_LIMIT) {
    registryCache.delete(registryCache.keys().next().value as string);
  }
  return result;
}
