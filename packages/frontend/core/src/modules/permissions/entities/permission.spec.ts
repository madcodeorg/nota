import { Permission } from '@nota/graphql';
import { Framework } from '@nota/infra';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, test, vi } from 'vitest';

import { WorkspaceService } from '../../workspace';
import { WorkspacePermissionStore } from '../stores/permission';
import { WorkspacePermission } from './permission';

const createPermission = (flavour: string) => {
  const cache$ = new BehaviorSubject<
    | {
        isOwner: boolean;
        isAdmin: boolean;
        isTeam: boolean;
      }
    | undefined
  >(undefined);
  const fetchWorkspaceInfo = vi.fn(async () => ({
    workspace: {
      role: Permission.Owner,
      team: false,
    },
  }));
  const workspaceService = {
    workspace: {
      flavour,
      id: 'workspace-id',
      openOptions: { isSharedMode: false },
    },
  } as WorkspaceService;
  const permissionStore = {
    watchWorkspacePermissionCache: () => cache$,
    fetchWorkspaceInfo,
    setWorkspacePermissionCache: vi.fn(value => cache$.next(value)),
  } as unknown as WorkspacePermissionStore;

  const framework = new Framework();
  framework.addValue(WorkspaceService, workspaceService);
  framework.addValue(WorkspacePermissionStore, permissionStore);
  framework.entity(WorkspacePermission, [
    WorkspaceService,
    WorkspacePermissionStore,
  ]);
  const provider = framework.provider();
  const permission = provider.createEntity(WorkspacePermission);

  return {
    fetchWorkspaceInfo,
    permission,
    provider,
  };
};

describe('WorkspacePermission', () => {
  test.each(['local', 'google-drive'])(
    'treats %s workspaces as locally owned',
    async flavour => {
      const { fetchWorkspaceInfo, permission, provider } =
        createPermission(flavour);
      const owner = permission.isOwner$.waitFor(value => value !== null);

      permission.revalidate();

      await expect(owner).resolves.toBe(true);
      expect(fetchWorkspaceInfo).not.toHaveBeenCalled();
      expect(permission.isTeam$.value).toBe(false);
      permission.dispose();
      provider.dispose();
    }
  );

  test('fetches membership for server-backed workspaces', async () => {
    const { fetchWorkspaceInfo, permission, provider } =
      createPermission('nota-cloud');
    const owner = permission.isOwner$.waitFor(value => value !== null);

    permission.revalidate();

    await expect(owner).resolves.toBe(true);
    expect(fetchWorkspaceInfo).toHaveBeenCalledOnce();
    permission.dispose();
    provider.dispose();
  });
});
