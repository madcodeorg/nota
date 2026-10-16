import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  cancelSignIn: vi.fn(() => {}),
  getCachedModels: vi.fn(() => []),
  refreshCatalog: vi.fn(async () => [
    { id: 'account-model', name: 'Account model' },
  ]),
  selectProfile: vi.fn(async (_id: string) => {}),
  signOut: vi.fn(async () => {}),
  startSignIn: vi.fn(async (_options: unknown) => ({
    url: 'https://auth.openai.com/api/accounts/authorize?state=test',
  })),
  status: vi.fn(() => ({
    connected: false,
    planEnabled: false,
    pending: false,
    activeProfileId: null,
    profiles: [],
  })),
}));

vi.mock('./chatgpt-auth', () => ({ getChatGPTAuth: () => auth }));

import { AiModelRouter } from './providers';
import { createServer } from './server';
import { CopilotStore } from './store';

let root: string;
let baseUrl: string;
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;
const token = 'nota-provider-route-test-token';

beforeEach(async () => {
  vi.clearAllMocks();
  auth.status.mockReturnValue({
    connected: false,
    planEnabled: false,
    pending: false,
    activeProfileId: null,
    profiles: [],
  });
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-provider-routes-'));
  vi.stubEnv('NOTA_AI_BACKEND_TOKEN', token);
  vi.stubEnv('NOTA_AI_WORKSPACE_ROOT', root);
  vi.stubEnv('NOTA_AI_SETTINGS_PATH', path.join(root, 'ai-settings.json'));
  vi.stubEnv('NOTA_AI_PROVIDER', 'local');
  const { app } = createServer();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function request(route: string, body?: unknown) {
  return fetch(`${baseUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-nota-backend-token': token,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('provider and ChatGPT routes', () => {
  it('refreshes a saved ChatGPT catalog without blocking local backend readiness', async () => {
    vi.stubEnv('NOTA_AI_PROVIDER', 'chatgpt');
    auth.status.mockReturnValue({
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: null,
      profiles: [],
    });
    auth.refreshCatalog.mockImplementationOnce(() => new Promise(() => {}));
    const backend = createServer();
    await backend.ready;
    expect(auth.refreshCatalog).toHaveBeenCalledOnce();
  });

  it('refreshes the session catalog after the callback changes connection state', async () => {
    await request('/api/ai/chatgpt/status');
    const update = vi.spyOn(CopilotStore.prototype, 'setDefaultModel');
    auth.status.mockReturnValueOnce({
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: null,
      profiles: [],
    });
    await request('/api/ai/chatgpt/status');
    expect(update).toHaveBeenCalledOnce();
  });

  it.each([
    '/api/ai/chatgpt/status',
    '/api/ai/chatgpt/models',
    '/api/ai/providers/openai/models',
  ])('protects %s with the desktop backend token', async route => {
    expect((await fetch(`${baseUrl}${route}`)).status).toBe(401);
    expect(auth.refreshCatalog).not.toHaveBeenCalled();
  });

  it('starts sign-in only after an explicit action and validates the request', async () => {
    expect((await request('/api/ai/chatgpt/status')).status).toBe(200);
    expect(auth.startSignIn).not.toHaveBeenCalled();
    expect(
      (await request('/api/ai/chatgpt/sign-in', { profileId: 12 })).status
    ).toBe(400);
    expect(auth.startSignIn).not.toHaveBeenCalled();
    const result = await request('/api/ai/chatgpt/sign-in', {
      newProfile: true,
    });
    expect(result.status).toBe(200);
    expect(auth.startSignIn).toHaveBeenCalledWith({
      profileId: undefined,
      newProfile: true,
    });
    expect(await result.json()).toEqual({
      url: 'https://auth.openai.com/api/accounts/authorize?state=test',
    });
  });

  it('rejects missing profile IDs and exposes account-specific model choices', async () => {
    expect((await request('/api/ai/chatgpt/select-profile', {})).status).toBe(
      400
    );
    await request('/api/ai/chatgpt/select-profile', { profileId: 'profile-2' });
    expect(auth.selectProfile).toHaveBeenCalledWith('profile-2');
    expect(await (await request('/api/ai/chatgpt/models')).json()).toEqual({
      models: [{ id: 'account-model', name: 'Account model' }],
    });
  });

  it('supports cancellation and disconnect without changing the selected provider', async () => {
    await request('/api/ai/chatgpt/cancel', {});
    await request('/api/ai/chatgpt/disconnect', {});
    expect(auth.cancelSignIn).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('rejects unknown providers instead of discovering local models', async () => {
    const discover = vi.spyOn(AiModelRouter.prototype, 'discoverModels');
    expect((await request('/api/ai/providers/typo/models')).status).toBe(400);
    expect(discover).not.toHaveBeenCalled();
  });

  it('discovers only the explicitly requested provider and reports failures clearly', async () => {
    const discover = vi
      .spyOn(AiModelRouter.prototype, 'discoverModels')
      .mockResolvedValueOnce([{ id: 'custom-model', name: 'Custom model' }])
      .mockRejectedValueOnce(
        new Error('Model discovery is unavailable. Enter a model ID manually.')
      );
    expect(
      await (await request('/api/ai/providers/deepinfra/models')).json()
    ).toEqual({
      models: [{ id: 'custom-model', name: 'Custom model' }],
    });
    expect(discover).toHaveBeenCalledWith('deepinfra');
    const failed = await request('/api/ai/providers/deepinfra/models');
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({
      error: 'Model discovery is unavailable. Enter a model ID manually.',
    });
  });
});
