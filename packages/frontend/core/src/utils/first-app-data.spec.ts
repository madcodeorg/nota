// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn() }));
vi.mock('../blocksuite/block-suite-editor', () => ({}));
vi.mock('@blocksuite/affine/widgets/linked-doc', () => ({
  ZipTransformer: { importDocs: vi.fn() },
}));
vi.mock('../modules/doc', () => ({ DocsService: class DocsService {} }));
vi.mock('../modules/organize', () => ({
  OrganizeService: class OrganizeService {},
}));
vi.mock('../modules/workspace', () => ({ getAFFiNEWorkspaceSchema: vi.fn() }));
vi.mock('@nota/templates/onboarding.zip', () => ({
  default: 'onboarding.zip',
}));

import type { WorkspacesService } from '../modules/workspace';
import type * as FirstAppDataModule from './first-app-data';
let firstAppData: typeof FirstAppDataModule;

function service() {
  return {
    create: mocks.create,
    open: () => ({
      workspace: {
        id: 'workspace-a',
        engine: { doc: { waitForDocReady: async () => {} } },
        // eslint-disable-next-line rxjs/finnish -- Match the DocsService LiveData API.
        scope: { get: () => ({ list: { docs$: { value: [] } } }) },
      },
      dispose: mocks.dispose,
    }),
  } as unknown as WorkspacesService;
}

describe('first workspace creation durability', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.resetModules();
    firstAppData = await import('./first-app-data');
    mocks.create.mockResolvedValue({ id: 'workspace-a', flavour: 'local' });
  });

  afterEach(() => vi.restoreAllMocks());

  test('a failed create leaves first launch retryable', async () => {
    const workspaceService = service();
    mocks.create.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).rejects.toThrow('disk unavailable');
    expect(localStorage.getItem('is-first-open')).toBeNull();
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).resolves.toMatchObject({
      meta: { id: 'workspace-a' },
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('is-first-open')).toBe('false');
  });

  test('concurrent calls share one workspace and mark completion after it is ready', async () => {
    const workspaceService = service();
    let resolveCreate!: (value: object) => void;
    mocks.create.mockReturnValue(
      new Promise(resolve => {
        resolveCreate = resolve;
      })
    );
    const first = firstAppData.createFirstAppData(workspaceService);
    const second = firstAppData.createFirstAppData(workspaceService);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(localStorage.getItem('is-first-open')).toBeNull();
    resolveCreate({ id: 'workspace-a', flavour: 'local' });
    expect(await first).toEqual(await second);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(localStorage.getItem('is-first-open')).toBe('false');
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).resolves.toBeUndefined();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  test('preference write failure does not reject a saved workspace', async () => {
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('preference quota');
    });
    const workspaceService = service();
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).resolves.toMatchObject({
      meta: { id: 'workspace-a' },
    });
    expect(write).toHaveBeenCalled();
    expect(firstAppData.isFirstAppOpen()).toBe(false);
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).resolves.toBeUndefined();
    expect(mocks.create).toHaveBeenCalledOnce();
    write.mockRestore();
  });

  test('denied preference access still creates a workspace and remembers completion', async () => {
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('preferences unavailable');
    });
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('preferences unavailable');
    });
    const workspaceService = service();
    expect(firstAppData.isFirstAppOpen()).toBe(true);
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).resolves.toMatchObject({
      meta: { id: 'workspace-a' },
    });
    expect(read).toHaveBeenCalled();
    expect(write).toHaveBeenCalled();
    expect(firstAppData.isFirstAppOpen()).toBe(false);
    await expect(
      firstAppData.createFirstAppData(workspaceService)
    ).resolves.toBeUndefined();
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});
