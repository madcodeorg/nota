import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetMcpPool } from './mcp';
import { mcpAuthFilePath, writeMcpAuth } from './mcp-oauth';
import {
  applyMcpServerInput,
  McpServerRequestError,
  removeMcpServer,
} from './mcp-servers';
import { createServer } from './server';

const TOKEN = 'test-nota-mcp-servers-token';
const SECRETS = [
  'secret-bearer-token',
  'secret-header-value',
  'secret-env-value',
  'secret-client-secret',
  'secret-extra-header',
];
const environmentKeys = [
  'NOTA_AI_BACKEND_TOKEN',
  'NOTA_AI_LOCAL_MODEL',
  'NOTA_AI_MCP_CONFIG',
  'NOTA_AI_MCP_ENABLED',
  'NOTA_AI_PROVIDER',
  'NOTA_AI_SETTINGS_PATH',
  'NOTA_AI_WORKSPACE_ROOT',
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map(key => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;

function inputError(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(McpServerRequestError);
    return error as McpServerRequestError;
  }
  throw new Error('Expected an MCP server input error.');
}

function servers(rawConfig: string) {
  return (JSON.parse(rawConfig) as { mcpServers: Record<string, any> })
    .mcpServers;
}

describe('applyMcpServerInput', () => {
  const remote = {
    auth: { token: 'secret-bearer-token', type: 'bearer' },
    connection: {
      headers: [{ name: 'X-Extra', value: 'secret-extra-header' }],
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    },
    description: 'Example',
    name: 'Example',
  };

  it('adds, edits with kept secrets, renames, and removes servers', () => {
    const added = applyMcpServerInput('', remote);
    expect(servers(added.mcpConfig)).toEqual({
      Example: {
        auth: { token: 'secret-bearer-token', type: 'bearer' },
        description: 'Example',
        enabled: true,
        headers: { 'X-Extra': 'secret-extra-header' },
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      },
    });

    const edited = applyMcpServerInput(added.mcpConfig, {
      ...remote,
      auth: { token: '', type: 'bearer' },
      connection: { ...remote.connection, headers: [{ name: 'X-Extra' }] },
      description: undefined,
      enabled: false,
      name: 'Renamed',
      originalName: 'Example',
    });
    expect(edited).toMatchObject({
      keepAuth: false,
      name: 'Renamed',
      originalName: 'Example',
    });
    expect(servers(edited.mcpConfig)).toEqual({
      Renamed: {
        auth: { token: 'secret-bearer-token', type: 'bearer' },
        description: 'Example',
        enabled: false,
        headers: { 'X-Extra': 'secret-extra-header' },
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      },
    });
  });

  it('keeps legacy unparsed entries and stdio cwd when editing', () => {
    const legacy = JSON.stringify({
      mcpServers: {
        Local: {
          command: 'node',
          cwd: '/tmp',
          env: { TOKEN: 'secret-env-value' },
        },
        Unknown: { something: true },
      },
    });
    const result = applyMcpServerInput(legacy, {
      auth: { type: 'none' },
      connection: {
        args: ['server.js'],
        command: 'node',
        env: [{ name: 'TOKEN', value: '' }],
        type: 'stdio',
      },
      name: 'Local',
      originalName: 'Local',
    });
    expect(servers(result.mcpConfig)).toEqual({
      Local: {
        args: ['server.js'],
        command: 'node',
        cwd: '/tmp',
        enabled: true,
        env: { TOKEN: 'secret-env-value' },
      },
      Unknown: { something: true },
    });
  });

  it('keeps OAuth credentials only for the same URL and client', () => {
    const oauth = {
      auth: {
        clientId: 'client',
        clientSecret: 'secret-client-secret',
        type: 'oauth',
      },
      connection: { type: 'http', url: 'https://mcp.example.com/mcp' },
      name: 'OAuth',
    };
    const added = applyMcpServerInput('', oauth);
    expect(added.keepAuth).toBe(false);
    const same = applyMcpServerInput(added.mcpConfig, {
      ...oauth,
      auth: { clientId: 'client', type: 'oauth' },
      originalName: 'OAuth',
    });
    expect(same.keepAuth).toBe(true);
    expect(servers(same.mcpConfig).OAuth.auth.clientSecret).toBe(
      'secret-client-secret'
    );
    expect(
      applyMcpServerInput(added.mcpConfig, {
        ...oauth,
        connection: { type: 'http', url: 'https://other.example.com/mcp' },
        originalName: 'OAuth',
      }).keepAuth
    ).toBe(false);
  });

  it.each([
    [{ ...remote, name: ' bad/name' }, 'Server names'],
    [{ ...remote, connection: { type: 'http', url: 'ftp://x' } }, 'https://'],
    [
      {
        ...remote,
        connection: { type: 'http', url: 'http://mcp.example.com' },
      },
      'only for localhost',
    ],
    [
      { ...remote, connection: { type: 'http', url: 'not a url' } },
      'valid server URL',
    ],
    [{ ...remote, connection: { command: '  ', type: 'stdio' } }, 'command'],
    [
      {
        ...remote,
        connection: {
          ...remote.connection,
          headers: [{ name: 'Bad Header', value: 'x' }],
        },
      },
      'Invalid header name',
    ],
    [
      {
        ...remote,
        connection: { ...remote.connection, headers: [{ name: 'X-New' }] },
      },
      'Enter a value',
    ],
    [{ ...remote, auth: { type: 'bearer' } }, 'bearer token'],
    [
      { ...remote, auth: { headerName: 'X-Key', type: 'header' } },
      'header value',
    ],
    [{ ...remote, icon: 'data:image/jpeg;base64,AAAA' }, 'PNG'],
    [{ ...remote, icon: `data:image/png;base64,${'A'.repeat(20_000)}` }, 'PNG'],
  ])('rejects invalid input %#', (input, message) => {
    const error = inputError(() => applyMcpServerInput('', input));
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain(message);
  });

  it('allows plain http only for localhost servers', () => {
    const result = applyMcpServerInput('', {
      ...remote,
      connection: { type: 'http', url: 'http://127.0.0.1:3000/mcp' },
    });
    expect(servers(result.mcpConfig).Example.url).toBe(
      'http://127.0.0.1:3000/mcp'
    );
  });

  it('keeps other config keys when rewriting servers', () => {
    const raw = JSON.stringify({
      inputs: [{ id: 'token' }],
      mcpServers: { Old: { command: 'node' } },
    });
    const added = applyMcpServerInput(raw, remote).mcpConfig;
    expect(JSON.parse(added)).toMatchObject({
      inputs: [{ id: 'token' }],
      mcpServers: { Example: { url: 'https://mcp.example.com/mcp' } },
    });
    expect(JSON.parse(removeMcpServer(added, 'Old'))).toEqual({
      inputs: [{ id: 'token' }],
      mcpServers: { Example: expect.any(Object) },
    });
  });

  it('rejects duplicate names and unknown originals', () => {
    const added = applyMcpServerInput('', remote).mcpConfig;
    expect(
      inputError(() => applyMcpServerInput(added, remote)).statusCode
    ).toBe(400);
    expect(
      inputError(() =>
        applyMcpServerInput(added, { ...remote, originalName: 'Missing' })
      ).statusCode
    ).toBe(404);
  });
});

describe('MCP server routes', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;
  let settingsPath = '';

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-mcp-servers-'));
    settingsPath = path.join(workspaceRoot, 'ai-settings.json');
    process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_MODEL = 'qwen3.5-2b-gguf-q4km';
    process.env.NOTA_AI_SETTINGS_PATH = settingsPath;
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    process.env.NOTA_AI_MCP_ENABLED = 'true';
    process.env.NOTA_AI_MCP_CONFIG = '{}';
    resetMcpPool();

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
    resetMcpPool();
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
    await rm(workspaceRoot, { force: true, recursive: true });
    for (const key of environmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  function request(method: string, route: string, body?: unknown) {
    return fetch(`${baseUrl}${route}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-nota-backend-token': TOKEN,
      },
      method,
    });
  }

  it('manages servers without returning secret values', async () => {
    const add = async (body: unknown) => {
      const response = await request('POST', '/api/ai/mcp/servers', body);
      expect(response.status).toBe(200);
      return ((await response.json()) as { server: any }).server;
    };

    expect(
      await add({
        auth: { type: 'none' },
        connection: {
          args: ['--version'],
          command: 'nota-missing-mcp-command',
          env: [{ name: 'API_KEY', value: 'secret-env-value' }],
          type: 'stdio',
        },
        enabled: false,
        name: 'Local tool',
      })
    ).toEqual({
      auth: { type: 'none' },
      connection: {
        args: ['--version'],
        command: 'nota-missing-mcp-command',
        env: [{ hasValue: true, name: 'API_KEY' }],
        type: 'stdio',
      },
      enabled: false,
      name: 'Local tool',
      status: { blockedToolNames: [], state: 'disabled', toolNames: [] },
    });

    expect(
      await add({
        auth: {
          headerName: 'X-Api-Key',
          type: 'header',
          value: 'secret-header-value',
        },
        connection: {
          headers: [{ name: 'X-Extra', value: 'secret-extra-header' }],
          type: 'sse',
          url: 'https://mcp.example.com/sse',
        },
        enabled: false,
        name: 'Header',
      })
    ).toMatchObject({
      auth: { hasValue: true, headerName: 'X-Api-Key', type: 'header' },
      connection: { headers: [{ hasValue: true, name: 'X-Extra' }] },
    });

    const oauth = await add({
      auth: {
        clientId: 'nota',
        clientSecret: 'secret-client-secret',
        type: 'oauth',
      },
      connection: { type: 'http', url: 'https://mcp.example.com/mcp' },
      name: 'OAuth',
    });
    expect(oauth).toMatchObject({
      auth: {
        clientId: 'nota',
        connected: false,
        hasClientSecret: true,
        type: 'oauth',
      },
      status: { state: 'auth-required' },
    });

    const list = await request('GET', '/api/ai/mcp/servers');
    expect(list.status).toBe(200);
    const listText = await list.text();
    const settingsText = await (
      await request('GET', '/api/ai/settings')
    ).text();
    for (const secret of SECRETS.filter(s => s !== 'secret-bearer-token')) {
      expect(await readFile(settingsPath, 'utf8')).toContain(secret);
      expect(listText).not.toContain(secret);
      expect(settingsText).not.toContain(secret);
    }
    expect(JSON.parse(settingsText).mcp).not.toHaveProperty('config');
    expect(JSON.parse(listText)).toMatchObject({
      enabled: true,
      servers: [
        { name: 'Local tool', status: { state: 'disabled' } },
        { name: 'Header', status: { state: 'disabled' } },
        { name: 'OAuth', status: { state: 'auth-required' } },
      ],
      toolsEnabled: true,
    });

    // Keep the pool from dialing the example host once tokens exist.
    await request('POST', '/api/ai/settings', { mcpEnabled: false });
    writeMcpAuth(settingsPath, 'OAuth', {
      tokens: { access_token: 'secret-bearer-token', token_type: 'Bearer' },
    });
    const renamed = await add({
      auth: { clientId: 'nota', type: 'oauth' },
      connection: { type: 'http', url: 'https://mcp.example.com/mcp' },
      name: 'OAuth 2',
      originalName: 'OAuth',
    });
    expect(renamed.auth).toMatchObject({
      connected: true,
      hasClientSecret: true,
    });
    await expect(
      stat(mcpAuthFilePath(settingsPath, 'OAuth'))
    ).rejects.toThrow();

    expect(
      (await request('POST', '/api/ai/mcp/servers/OAuth%202/oauth/disconnect'))
        .status
    ).toBe(204);
    await expect(
      stat(mcpAuthFilePath(settingsPath, 'OAuth 2'))
    ).rejects.toThrow();

    expect(
      (await request('POST', '/api/ai/mcp/servers/Header/oauth/start')).status
    ).toBe(400);
    expect((await request('DELETE', '/api/ai/mcp/servers/Header')).status).toBe(
      204
    );
    expect((await request('DELETE', '/api/ai/mcp/servers/Header')).status).toBe(
      404
    );
    expect(
      Object.keys(
        JSON.parse(
          JSON.parse(await readFile(settingsPath, 'utf8')).settings.mcpConfig
        ).mcpServers
      )
    ).toEqual(['Local tool', 'OAuth 2']);
  });

  it('rejects invalid input with 400 and reports every server disabled when MCP is off', async () => {
    const invalid = await request('POST', '/api/ai/mcp/servers', {
      auth: { type: 'none' },
      connection: { type: 'http', url: 'file:///etc/passwd' },
      name: 'Bad',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toHaveProperty('error');

    await request('POST', '/api/ai/settings', { mcpEnabled: false });
    await request('POST', '/api/ai/mcp/servers', {
      auth: { type: 'none' },
      connection: { command: 'nota-missing-mcp-command', type: 'stdio' },
      name: 'Local',
    });
    expect(await (await request('GET', '/api/ai/mcp/servers')).json()).toEqual({
      enabled: false,
      servers: [
        expect.objectContaining({
          name: 'Local',
          status: expect.objectContaining({ state: 'disabled' }),
        }),
      ],
      toolsEnabled: true,
    });
  });

  it('reports a config parse error with an empty server list', async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ settings: { mcpConfig: '{not json', mcpEnabled: true } })
    );
    server.close();
    const { app } = createServer();
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const body = (await (
      await request('GET', '/api/ai/mcp/servers')
    ).json()) as {
      error?: string;
      servers: unknown[];
    };
    expect(body.servers).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});
