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
  user: { sub: 'owner' } as { sub: string } | null,
  owner: 'owner' as string | undefined,
  usedKeys: vi.fn(),
  withDrive: vi.fn(),
  cleanUp: vi.fn(),
  usage: vi.fn(),
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
}));
vi.mock('@nota/core/modules/google-auth', () => ({
  GoogleAuthService: class GoogleAuthService {},
}));
vi.mock('@nota/core/modules/blob-management/services', () => ({
  BlobManagementService: class BlobManagementService {},
}));
vi.mock('@nota/core/modules/workspace-engine/impls/google-drive', () => ({
  getGoogleDriveWorkspaceOwner: () => mocks.owner,
}));
vi.mock(
  '@nota/core/modules/workspace-engine/impls/google-drive-maintenance',
  () => ({ withGoogleDrive: mocks.withDrive })
);
vi.mock('@nota/nbstore/google-drive', () => ({
  cleanUpDriveAttachments: mocks.cleanUp,
  getDriveUsage: mocks.usage,
}));
vi.mock('@nota/infra', () => ({
  useLiveData: () => mocks.user,
  useService: (service: { name: string }) =>
    service.name === 'WorkspaceService'
      ? { workspace: { id: 'ws', flavour: 'google-drive' } }
      : service.name === 'BlobManagementService'
        ? { unusedBlobs: { getUsedBlobKeys: mocks.usedKeys } }
        : { session: { userInfo$: { value: mocks.user } } },
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

import {
  formatBytes,
  GoogleDriveMaintenancePanel,
} from './google-drive-maintenance';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { sub: 'owner' };
  mocks.owner = 'owner';
  mocks.withDrive.mockImplementation(
    async (_auth, task: (connection: unknown) => unknown) => task('connection')
  );
});
afterEach(cleanup);

describe('Google Drive maintenance controls', () => {
  test('cleans up with the keys current pages use and explains the 30-day wait', async () => {
    mocks.usedKeys.mockResolvedValue(new Set(['used']));
    mocks.cleanUp.mockResolvedValue({
      marked: 2,
      deleted: 1,
      restored: 0,
      waiting: 0,
      freedBytes: 2048,
    });
    render(<GoogleDriveMaintenancePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Clean up' }));
    await waitFor(() =>
      expect(screen.getByText(/Deleted 1 attachment \(2\.0 KB\)/)).toBeTruthy()
    );
    expect(
      screen.getByText(/2 unused attachments will be deleted/)
    ).toBeTruthy();
    expect(mocks.cleanUp).toHaveBeenCalledWith(
      'connection',
      'ws',
      new Set(['used'])
    );
    expect(mocks.withDrive.mock.calls[0][2]).toBe('owner');
  });

  test('shows workspace and account usage', async () => {
    mocks.usage.mockResolvedValue({
      accountUsage: 5 * 1024 ** 3,
      accountLimit: 15 * 1024 ** 3,
      syncBytes: 3 * 1024 ** 2,
      syncFiles: 40,
      backupBytes: 1024 ** 2,
      backupFiles: 7,
    });
    render(<GoogleDriveMaintenancePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Check usage' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          /uses 3\.0 MB in 40 sync files and 1\.0 MB in 7 backup copies/
        )
      ).toBeTruthy()
    );
    expect(screen.getByText(/5\.0 GB of 15 GB/)).toBeTruthy();
  });

  test('another signed-in account cannot use the controls', () => {
    mocks.user = { sub: 'someone-else' };
    render(<GoogleDriveMaintenancePanel />);
    expect(
      (screen.getByRole('button', { name: 'Clean up' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  test('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 ** 2)).toBe('20 MB');
  });
});
