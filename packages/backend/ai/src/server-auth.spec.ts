import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServer } from './server';

const TOKEN = 'test-nota-backend-token';
const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  devServerUrl: process.env.DEV_SERVER_URL,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

let workspaceRoot = '';
let baseUrl = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-ai-auth-'));
  process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
  process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
  process.env.DEV_SERVER_URL = 'http://localhost:8080';

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
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
  await rm(workspaceRoot, { force: true, recursive: true });

  for (const [name, value] of Object.entries({
    DEV_SERVER_URL: originalEnvironment.devServerUrl,
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_WORKSPACE_ROOT: originalEnvironment.workspaceRoot,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function authenticatedHeaders(origin?: string) {
  return {
    ...(origin ? { Origin: origin } : {}),
    'x-nota-backend-token': TOKEN,
  };
}

describe('AI backend access boundary', () => {
  it('rejects missing and incorrect backend credentials', async () => {
    const missing = await fetch(`${baseUrl}/api/health`);
    expect(missing.status).toBe(401);

    const incorrect = await fetch(`${baseUrl}/api/health`, {
      headers: { 'x-nota-backend-token': 'wrong-token' },
    });
    expect(incorrect.status).toBe(401);
  });

  it('accepts authenticated native requests without an Origin header', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: authenticatedHeaders(),
    });
    expect(response.status).toBe(200);
  });

  it.each(['assets://.', 'assets://another-host', 'http://localhost:8080'])(
    'accepts the authenticated Nota renderer origin %s',
    async origin => {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: authenticatedHeaders(origin),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    }
  );

  it('rejects a foreign browser origin even with a valid token', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: authenticatedHeaders('https://evil.example'),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers allowed preflight requests without exposing the backend token', async () => {
    const response = await fetch(`${baseUrl}/api/ai/settings`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'assets://.',
        'Access-Control-Request-Headers': 'content-type,x-nota-backend-token',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'assets://.'
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'x-nota-backend-token'
    );
  });
});
