/* eslint-disable rxjs/finnish */
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  user: null as { sub: string } | null,
  owner: undefined as string | undefined,
  paused: false,
  setPaused: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  toDrive: vi.fn(),
  toLocal: vi.fn(),
  jump: vi.fn(),
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
}));
vi.mock('@nota/core/modules/google-auth', () => ({
  GoogleAuthService: class GoogleAuthService {},
}));
vi.mock('@nota/core/modules/workspace/services/transform', () => ({
  WorkspaceTransformService: class WorkspaceTransformService {},
}));
vi.mock('@nota/core/modules/workspace-engine/impls/google-drive', () => ({
  getGoogleDriveWorkspaceOwner: () => mocks.owner,
  isGoogleDriveWorkspaceSyncPaused: () => mocks.paused,
  setGoogleDriveWorkspaceSyncPaused: (...args: unknown[]) =>
    mocks.setPaused(...args),
}));
vi.mock('@nota/core/components/hooks/use-navigate-helper', () => ({
  useNavigateHelper: () => ({ jumpToPage: mocks.jump }),
}));
vi.mock('@nota/infra', () => ({
  useLiveData: () => mocks.user,
  useService: (service: { name: string }) =>
    service.name === 'WorkspaceService'
      ? { workspace: mocks.workspace }
      : service.name === 'WorkspaceTransformService'
        ? {
            transformLocalToCloud: mocks.toDrive,
            transformDriveToLocal: mocks.toLocal,
          }
        : {
            connect: mocks.connect,
            disconnect: mocks.disconnect,
            session: {
              userInfo$: {
                get value() {
                  return mocks.user;
                },
              },
            },
          },
}));
vi.mock('@nota/component/setting-components', () => ({
  SettingRow: ({
    name,
    desc,
    children,
  }: {
    name: string;
    desc: string;
    children: ReactNode;
  }) => (
    <section>
      <h3>{name}</h3>
      <p>{desc}</p>
      {children}
    </section>
  ),
}));
vi.mock('@nota/component/ui/button', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import { GoogleDriveStoragePanel } from './google-drive';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  mocks.owner = undefined;
  mocks.paused = false;
  mocks.workspace = {
    id: 'source',
    flavour: 'local',
    meta: { id: 'source', flavour: 'local' },
    engine: {
      client: { setGoogleDriveTokens: vi.fn().mockResolvedValue(undefined) },
    },
  };
  mocks.connect.mockImplementation(async () => {
    mocks.user = { sub: 'owner' };
  });
  mocks.toDrive.mockResolvedValue({
    id: 'drive-copy',
    flavour: 'google-drive',
  });
  mocks.toLocal.mockResolvedValue({ id: 'local-copy', flavour: 'local' });
});
afterEach(cleanup);

describe('optional Google Drive storage controls', () => {
  test('connects explicitly and opens a verified synced copy while explaining that the original remains', async () => {
    render(<GoogleDriveStoragePanel />);
    expect(
      screen.getByText(/Your original local workspace is retained/)
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('drive-copy', 'all')
    );
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.toDrive).toHaveBeenCalledWith(
      mocks.workspace,
      null,
      'google-drive'
    );
  });

  test('failed copying stays visible without navigating away from the original', async () => {
    mocks.toDrive.mockRejectedValue(
      new Error('Attachment is unavailable. Original workspace retained.')
    );
    render(<GoogleDriveStoragePanel />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Attachment is unavailable'
      )
    );
    expect(mocks.jump).not.toHaveBeenCalled();
  });

  test('awaits the setup handoff before navigating to a newly connected workspace', async () => {
    let complete: () => void = () => {};
    const onConnected = vi.fn(
      () => new Promise<void>(resolve => (complete = resolve))
    );
    render(<GoogleDriveStoragePanel onConnected={onConnected} />);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.toDrive).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    await waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith({
        id: 'drive-copy',
        flavour: 'google-drive',
      })
    );
    expect(mocks.jump).not.toHaveBeenCalled();
    complete();
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('drive-copy', 'all')
    );
    expect(mocks.toDrive).toHaveBeenCalledOnce();
  });

  test('reports a resumed Drive workspace without copying it again', async () => {
    mocks.workspace.flavour = 'google-drive';
    mocks.workspace.meta.flavour = 'google-drive';
    mocks.owner = 'owner';
    mocks.user = { sub: 'owner' };
    mocks.paused = true;
    const onConnected = vi.fn();
    render(<GoogleDriveStoragePanel onConnected={onConnected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect sync' }));
    await waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith(mocks.workspace.meta)
    );
    expect(mocks.setPaused).toHaveBeenCalledWith('source', false);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.toDrive).not.toHaveBeenCalled();
    expect(mocks.jump).not.toHaveBeenCalled();
  });

  test('closing setup during authentication does not begin a workspace copy afterward', async () => {
    let authenticated: () => void = () => {};
    mocks.connect.mockImplementation(
      () => new Promise<void>(resolve => (authenticated = resolve))
    );
    const onConnected = vi.fn();
    const view = render(<GoogleDriveStoragePanel onConnected={onConnected} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    view.unmount();
    authenticated();
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(mocks.toDrive).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    expect(mocks.jump).not.toHaveBeenCalled();
  });

  test('closing setup while a verified Drive copy finishes suppresses stale handoff and navigation', async () => {
    let copied: (metadata: { id: string; flavour: string }) => void = () => {};
    mocks.toDrive.mockImplementation(
      () => new Promise(resolve => (copied = resolve))
    );
    const onConnected = vi.fn();
    const view = render(<GoogleDriveStoragePanel onConnected={onConnected} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Google Drive' })
    );
    await waitFor(() => expect(mocks.toDrive).toHaveBeenCalledOnce());
    view.unmount();
    copied({ id: 'drive-copy', flavour: 'google-drive' });
    await Promise.resolve();
    expect(onConnected).not.toHaveBeenCalled();
    expect(mocks.jump).not.toHaveBeenCalled();
    expect(mocks.toDrive).toHaveBeenCalledOnce();
  });

  test('disconnect pauses only workspace sync and clears worker credentials without signing out or deleting Drive data', async () => {
    mocks.workspace.flavour = 'google-drive';
    mocks.owner = 'owner';
    mocks.user = { sub: 'owner' };
    render(<GoogleDriveStoragePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect sync' }));
    await waitFor(() =>
      expect(
        mocks.workspace.engine.client.setGoogleDriveTokens
      ).toHaveBeenCalledWith(null)
    );
    expect(mocks.setPaused).toHaveBeenCalledWith('source', true);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.toDrive).not.toHaveBeenCalled();
  });

  test('another signed-in account cannot reconnect the cached owner workspace', async () => {
    mocks.workspace.flavour = 'google-drive';
    mocks.owner = 'owner-A';
    mocks.user = { sub: 'owner-B' };
    mocks.connect.mockResolvedValue(undefined);
    render(<GoogleDriveStoragePanel />);
    expect(screen.getByText(/Saved locally/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect sync' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'account that owns this workspace'
      )
    );
    expect(mocks.setPaused).not.toHaveBeenCalled();
    expect(mocks.toDrive).not.toHaveBeenCalled();
  });

  test('keeps a local copy available while logged out without requiring authentication', async () => {
    mocks.workspace.flavour = 'google-drive';
    mocks.paused = true;
    render(<GoogleDriveStoragePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep a local copy' }));
    await waitFor(() =>
      expect(mocks.jump).toHaveBeenCalledWith('local-copy', 'all')
    );
    expect(mocks.toLocal).toHaveBeenCalledWith(mocks.workspace);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });
});
