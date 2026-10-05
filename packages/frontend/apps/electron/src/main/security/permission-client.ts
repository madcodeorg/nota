import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { app } from 'electron';

export type MacOSPermissionClient = {
  bundleIdentifier: string | null;
  displayName: string;
  kind: 'development-host' | 'packaged-build';
};

type PermissionClientInput = {
  bundleIdentifier?: string | null;
  displayName?: string | null;
  isPackaged: boolean;
};

export function resolveMacOSPermissionClient({
  bundleIdentifier,
  displayName,
  isPackaged,
}: PermissionClientInput): MacOSPermissionClient {
  return {
    bundleIdentifier: bundleIdentifier?.trim() || null,
    displayName: displayName?.trim() || (isPackaged ? 'Nota' : 'Electron'),
    kind: isPackaged ? 'packaged-build' : 'development-host',
  };
}

function readMainBundlePlistValue(key: string) {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const appBundlePath = path.resolve(path.dirname(process.execPath), '../..');
    return execFileSync(
      '/usr/bin/plutil',
      [
        '-extract',
        key,
        'raw',
        '-o',
        '-',
        path.join(appBundlePath, 'Contents', 'Info.plist'),
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
  } catch {
    return null;
  }
}

let cachedPermissionClient: MacOSPermissionClient | null = null;

/**
 * The bundle identity intended to own this process's macOS permissions. The
 * development launcher uses LaunchServices so Nota Dev is the TCC subject;
 * directly spawning Electron from another GUI app can instead inherit that
 * parent's TCC responsibility.
 */
export function getMacOSPermissionClient(): MacOSPermissionClient {
  if (cachedPermissionClient) {
    return cachedPermissionClient;
  }

  cachedPermissionClient = resolveMacOSPermissionClient({
    bundleIdentifier: readMainBundlePlistValue('CFBundleIdentifier'),
    displayName:
      readMainBundlePlistValue('CFBundleDisplayName') || app.getName(),
    isPackaged: app.isPackaged,
  });
  return cachedPermissionClient;
}
