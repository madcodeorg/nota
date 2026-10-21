import { describe, expect, test } from 'vitest';

import {
  draftFromRegistry,
  draftFromServer,
  draftToInput,
  emptyDraft,
  type RegistryEntry,
  sanitizeServerName,
  sortedInstalls,
  validateDraft,
} from './api';

const entry = (installs: RegistryEntry['installs']): RegistryEntry => ({
  name: 'io.github.acme/weather-server',
  description: 'Weather lookups.',
  version: '1.0.0',
  installs,
});

describe('registry entry to draft', () => {
  test('maps a required Authorization bearer header to API key auth', () => {
    const draft = draftFromRegistry(entry([]), {
      kind: 'remote',
      type: 'http',
      url: 'https://weather.example.com/mcp',
      headers: [
        {
          name: 'Authorization',
          required: true,
          secret: true,
          value: 'Bearer {api_key}',
        },
        { name: 'X-Region', required: false, secret: false, value: 'eu' },
        {
          name: 'X-Org',
          required: true,
          secret: false,
          value: '{org_id}',
        },
      ],
    });
    expect(draft).toMatchObject({
      name: 'weather-server',
      description: 'Weather lookups.',
      mode: 'remote',
      url: 'https://weather.example.com/mcp',
      transport: 'http',
      authType: 'bearer',
      headers: [
        { name: 'X-Region', value: 'eu', optional: true },
        { name: 'X-Org', value: '', optional: false },
      ],
    });
  });

  test('maps another required secret header to custom header auth', () => {
    const draft = draftFromRegistry(
      { ...entry([]), title: 'Weather Pro' },
      {
        kind: 'remote',
        type: 'sse',
        url: 'https://weather.example.com/sse',
        headers: [{ name: 'X-API-Key', required: true, secret: true }],
      }
    );
    expect(draft).toMatchObject({
      name: 'Weather Pro',
      transport: 'sse',
      authType: 'header',
      headerName: 'X-API-Key',
      headers: [],
    });
  });

  test('maps a package to a local command with env rows', () => {
    const draft = draftFromRegistry(entry([]), {
      kind: 'package',
      registryType: 'npm',
      command: 'npx',
      args: ['-y', '@acme/weather@1.0.0'],
      env: [
        {
          name: 'WEATHER_KEY',
          required: true,
          secret: true,
          default: 'ignored',
          description: 'Your API key',
        },
        { name: 'UNITS', required: false, secret: false, default: 'metric' },
      ],
    });
    expect(draft).toMatchObject({
      mode: 'stdio',
      command: 'npx',
      args: '-y\n@acme/weather@1.0.0',
      authType: 'none',
      env: [
        {
          name: 'WEATHER_KEY',
          value: '',
          optional: false,
          description: 'Your API key',
        },
        { name: 'UNITS', value: 'metric', optional: true },
      ],
    });
    expect(validateDraft(draft).form).toBe('Enter a value for WEATHER_KEY.');
  });

  test('sanitizes names to the server name rules', () => {
    expect(sanitizeServerName('@acme/weather: v2!')).toBe('acme-weather- v2-');
    expect(sanitizeServerName('x'.repeat(80))).toHaveLength(64);
    expect(sanitizeServerName('***')).toBe('MCP server');
  });

  test('prefers remote installs', () => {
    const remote = {
      kind: 'remote' as const,
      type: 'http' as const,
      url: 'https://a.example.com',
      headers: [],
    };
    const pkg = {
      kind: 'package' as const,
      registryType: 'pypi' as const,
      command: 'uvx',
      args: ['a'],
      env: [],
    };
    expect(sortedInstalls(entry([pkg, remote]))).toEqual([remote, pkg]);
  });
});

describe('draft to input', () => {
  test('drops blank optional rows and keeps saved secrets', () => {
    const draft = draftFromServer({
      name: 'docs',
      enabled: true,
      connection: {
        type: 'http',
        url: 'https://docs.example.com/mcp',
        headers: [{ name: 'X-Key', hasValue: true }],
      },
      auth: { type: 'header', headerName: 'X-Token', hasValue: true },
      status: { state: 'ready', toolNames: [], blockedToolNames: [] },
    });
    draft.headers.push({ name: 'X-Optional', value: '', optional: true });
    expect(validateDraft(draft, ['docs'])).toEqual({ form: undefined });
    expect(draftToInput(draft)).toEqual({
      originalName: 'docs',
      name: 'docs',
      description: '',
      icon: '',
      enabled: true,
      connection: {
        type: 'http',
        url: 'https://docs.example.com/mcp',
        headers: [{ name: 'X-Key' }],
      },
      auth: { type: 'header', headerName: 'X-Token', value: undefined },
    });
  });

  test('rejects duplicate names and non-http URLs', () => {
    const draft = { ...emptyDraft(), name: 'docs', url: 'ftp://x' };
    expect(validateDraft(draft, ['docs'])).toEqual({
      name: 'A server with this name already exists.',
      form: 'Enter a server URL starting with https://. Plain http:// works only for localhost.',
    });
  });

  test('allows plain http only for localhost', () => {
    const draft = { ...emptyDraft(), name: 'docs' };
    expect(
      validateDraft({ ...draft, url: 'http://example.com/mcp' }, []).form
    ).toContain('only for localhost');
    expect(
      validateDraft({ ...draft, url: 'http://localhost:3000/mcp' }, []).form
    ).toBeUndefined();
  });
});
