import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AiBackendModule from '../../src/main/ai-backend';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  fork: vi.fn(),
  info: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/nota-app'),
    getPath: vi.fn(() => '/tmp/nota-user-data'),
    isPackaged: false,
  },
  utilityProcess: { fork: mocks.fork },
}));

vi.mock('../../src/main/cleanup', () => ({
  beforeAppQuit: vi.fn(),
}));

vi.mock('../../src/main/logger', () => ({
  logger: mocks,
}));

const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  backendUrl: process.env.NOTA_AI_BACKEND_URL,
};

let aiBackend: typeof AiBackendModule;

beforeEach(async () => {
  delete process.env.NOTA_AI_BACKEND_TOKEN;
  delete process.env.NOTA_AI_BACKEND_URL;
  mocks.error.mockReset();
  mocks.fork.mockReset();
  mocks.info.mockReset();
  vi.resetModules();
  aiBackend = await import('../../src/main/ai-backend');
});

afterEach(() => {
  for (const [name, value] of Object.entries({
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_BACKEND_URL: originalEnvironment.backendUrl,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('optional AI backend startup', () => {
  it('gives packaged ONNX models enough heap and logs fatal reports without secrets', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn(),
      pid: 1234,
      postMessage: vi.fn(),
      stderr,
      stdout,
    });
    mocks.fork.mockReturnValue(child);

    const started = aiBackend.startAiBackend();
    const options = mocks.fork.mock.calls[0]?.[2];
    expect(options).toMatchObject({
      serviceName: 'nota-ai-backend',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.emit('message', {
      host: '127.0.0.1',
      instanceId: options.env.NOTA_AI_INSTANCE_ID,
      port: 4242,
      type: 'nota-ai-backend-ready',
      workspaceRoot: options.env.NOTA_AI_WORKSPACE_ROOT,
    });
    await expect(started).resolves.toBe(child);

    stdout.write('backend ready\n');
    stderr.write('backend warning\n');
    child.emit(
      'error',
      'FatalError',
      'node::OOMErrorHandler',
      JSON.stringify({
        environmentVariables: { NOTA_AI_BACKEND_TOKEN: 'must-not-leak' },
        header: { event: 'Allocation failed - JavaScript heap out of memory' },
        javascriptHeap: {
          memoryLimit: 4_345_298_944,
          usedMemory: 4_300_000_000,
        },
        javascriptStack: { message: 'JavaScript heap out of memory' },
      })
    );

    expect(mocks.info).toHaveBeenCalledWith('[ai-backend] backend ready');
    expect(mocks.error).toHaveBeenCalledWith('[ai-backend] backend warning');
    const fatalLog = String(mocks.error.mock.calls.at(-1)?.[0]);
    expect(fatalLog).toContain('FatalError at node::OOMErrorHandler');
    expect(fatalLog).toContain('JavaScript heap out of memory');
    expect(fatalLog).not.toContain('must-not-leak');
  });

  it('records unavailability and resolves so the notes workspace can launch', async () => {
    const start = vi.fn(async () => {
      throw new Error('seed installation failed');
    });

    await expect(aiBackend.startAiBackendSafely(start)).resolves.toBeNull();
    expect(aiBackend.getAiBackendStatus()).toEqual({
      available: false,
      error: 'seed installation failed',
    });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'continuing with the local notes workspace: seed installation failed'
      )
    );
  });
});
