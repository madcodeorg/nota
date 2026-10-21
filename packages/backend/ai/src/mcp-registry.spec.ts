import { describe, expect, it, vi } from 'vitest';

import { fetchRegistryServers, mapRegistryResponse } from './mcp-registry';

const official = (status: string) => ({
  _meta: {
    'io.modelcontextprotocol.registry/official': { isLatest: true, status },
  },
});

const fixture = {
  metadata: { count: 4, nextCursor: 'next-page' },
  servers: [
    {
      ...official('active'),
      server: {
        description: 'Remote server',
        icons: [
          { src: 'http://insecure.example/icon.png' },
          { src: 'https://cdn.example/icon.png' },
        ],
        name: 'io.example/remote',
        remotes: [
          {
            headers: [
              {
                description: 'API key',
                isRequired: true,
                isSecret: true,
                name: 'X-Api-Key',
              },
            ],
            type: 'streamable-http',
            url: 'https://mcp.example.com/mcp',
          },
          { type: 'sse', url: 'https://mcp.example.com/sse' },
          { type: 'websocket', url: 'wss://mcp.example.com' },
        ],
        repository: {
          source: 'github',
          url: 'https://github.com/example/remote',
        },
        title: 'Remote',
        version: '1.0.0',
        websiteUrl: 'https://example.com',
      },
    },
    {
      ...official('active'),
      server: {
        description: 'Packages',
        name: 'io.example/packages',
        packages: [
          {
            environmentVariables: [
              { isRequired: true, isSecret: true, name: 'API_TOKEN' },
              { default: 'info', name: 'LOG_LEVEL' },
            ],
            identifier: '@example/mcp',
            packageArguments: [
              { type: 'positional', value: 'serve' },
              { name: '--port', type: 'named', value: '1' },
            ],
            registryType: 'npm',
            transport: { type: 'stdio' },
            version: '2.1.0',
          },
          {
            identifier: 'example-mcp',
            registryType: 'pypi',
            transport: { type: 'stdio' },
            version: '0.3.0',
          },
          {
            environmentVariables: [{ isRequired: true, name: 'API_TOKEN' }],
            identifier: 'ghcr.io/example/mcp:1.0',
            registryType: 'oci',
            transport: { type: 'stdio' },
          },
          {
            identifier: 'example',
            registryType: 'nuget',
            transport: { type: 'stdio' },
          },
          {
            identifier: '@example/http',
            registryType: 'npm',
            transport: {
              type: 'streamable-http',
              url: 'http://localhost:3000',
            },
          },
        ],
        version: '2.1.0',
      },
    },
    {
      ...official('deleted'),
      server: {
        description: 'Deleted',
        name: 'io.example/deleted',
        remotes: [{ type: 'streamable-http', url: 'https://deleted.example' }],
        version: '1.0.0',
      },
    },
    {
      ...official('deprecated'),
      server: {
        description: 'Deprecated',
        name: 'io.example/deprecated',
        remotes: [{ type: 'sse', url: 'https://deprecated.example' }],
        version: '1.0.0',
      },
    },
    {
      ...official('active'),
      server: {
        description: 'Nothing usable',
        name: 'io.example/empty',
        version: '1.0.0',
      },
    },
  ],
};

describe('MCP Registry mapping', () => {
  it('maps remotes and stdio packages and drops unusable entries', () => {
    expect(mapRegistryResponse(fixture)).toEqual({
      nextCursor: 'next-page',
      servers: [
        {
          description: 'Remote server',
          icon: 'https://cdn.example/icon.png',
          installs: [
            {
              headers: [
                {
                  description: 'API key',
                  name: 'X-Api-Key',
                  required: true,
                  secret: true,
                },
              ],
              kind: 'remote',
              type: 'http',
              url: 'https://mcp.example.com/mcp',
            },
            {
              headers: [],
              kind: 'remote',
              type: 'sse',
              url: 'https://mcp.example.com/sse',
            },
          ],
          name: 'io.example/remote',
          repositoryUrl: 'https://github.com/example/remote',
          title: 'Remote',
          version: '1.0.0',
          websiteUrl: 'https://example.com',
        },
        {
          description: 'Packages',
          installs: [
            {
              args: ['-y', '@example/mcp@2.1.0', 'serve'],
              command: 'npx',
              env: [
                { name: 'API_TOKEN', required: true, secret: true },
                {
                  default: 'info',
                  name: 'LOG_LEVEL',
                  required: false,
                  secret: false,
                },
              ],
              kind: 'package',
              registryType: 'npm',
            },
            {
              args: ['example-mcp==0.3.0'],
              command: 'uvx',
              env: [],
              kind: 'package',
              registryType: 'pypi',
            },
            {
              args: [
                'run',
                '-i',
                '--rm',
                '-e',
                'API_TOKEN',
                'ghcr.io/example/mcp:1.0',
              ],
              command: 'docker',
              env: [{ name: 'API_TOKEN', required: true, secret: false }],
              kind: 'package',
              registryType: 'oci',
            },
          ],
          name: 'io.example/packages',
          version: '2.1.0',
        },
      ],
    });
  });

  it('queries the latest versions with search and cursor', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ metadata: { count: 0 }, servers: [] }))
    );
    await expect(
      fetchRegistryServers({ cursor: 'abc', search: 'git hub' }, fetchFn)
    ).resolves.toEqual({ servers: [] });
    const url = new URL(String((fetchFn.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe(
      'https://registry.modelcontextprotocol.io/v0.1/servers'
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cursor: 'abc',
      limit: '30',
      search: 'git hub',
      version: 'latest',
    });
  });

  it('reuses a recent response for the same query', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ servers: [] }))
    );
    await fetchRegistryServers({ search: 'cached-query' }, fetchFn);
    await fetchRegistryServers({ search: 'cached-query' }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fails on registry HTTP errors', async () => {
    await expect(
      fetchRegistryServers(
        {},
        async () => new Response('down', { status: 503 })
      )
    ).rejects.toThrow('HTTP 503');
  });
});
