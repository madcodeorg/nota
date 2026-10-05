import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getName: () => 'Nota',
    isPackaged: false,
  },
}));

import { resolveMacOSPermissionClient } from '../../src/main/security/permission-client';

describe('resolveMacOSPermissionClient', () => {
  it('identifies the raw Electron development host', () => {
    expect(
      resolveMacOSPermissionClient({
        bundleIdentifier: 'com.github.Electron',
        displayName: 'Electron',
        isPackaged: false,
      })
    ).toEqual({
      bundleIdentifier: 'com.github.Electron',
      displayName: 'Electron',
      kind: 'development-host',
    });
  });

  it('identifies the signed Nota development host', () => {
    expect(
      resolveMacOSPermissionClient({
        bundleIdentifier: 'pro.nota.app.dev',
        displayName: 'Nota Dev',
        isPackaged: false,
      })
    ).toEqual({
      bundleIdentifier: 'pro.nota.app.dev',
      displayName: 'Nota Dev',
      kind: 'development-host',
    });
  });

  it('identifies a packaged Nota app', () => {
    expect(
      resolveMacOSPermissionClient({
        bundleIdentifier: 'pro.nota.app',
        displayName: 'Nota',
        isPackaged: true,
      })
    ).toEqual({
      bundleIdentifier: 'pro.nota.app',
      displayName: 'Nota',
      kind: 'packaged-build',
    });
  });

  it('uses truthful fallbacks when bundle metadata is unavailable', () => {
    expect(
      resolveMacOSPermissionClient({
        isPackaged: false,
      })
    ).toEqual({
      bundleIdentifier: null,
      displayName: 'Electron',
      kind: 'development-host',
    });
  });
});
