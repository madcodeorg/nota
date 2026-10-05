import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from './server';

const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  instanceId: process.env.NOTA_AI_INSTANCE_ID,
  port: process.env.NOTA_AI_PORT,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_INSTANCE_ID: originalEnvironment.instanceId,
    NOTA_AI_PORT: originalEnvironment.port,
    NOTA_AI_WORKSPACE_ROOT: originalEnvironment.workspaceRoot,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('AI backend health ownership', () => {
  it('reports the owning app instance and workspace root', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-ai-health-')
    );
    process.env.NOTA_AI_INSTANCE_ID = 'test-instance';
    process.env.NOTA_AI_BACKEND_TOKEN = 'test-backend-token';
    process.env.NOTA_AI_PORT = '0';
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;

    const { app } = createServer();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    try {
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).toBe('object');
      const port = typeof address === 'object' && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { 'x-nota-backend-token': 'test-backend-token' },
      });
      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        instanceId: 'test-instance',
        ok: true,
        workspaceRoot,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
