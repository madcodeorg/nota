import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { canInstallUpdate } from '../../src/main/updater/capabilities';

const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nota-updater-'));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) {
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('installer capability detection', () => {
  it('AppImage requires an existing absolute image and writable parent', () => {
    const directory = temporary();
    const image = path.join(directory, 'Nota.AppImage');
    const options = { platform: 'linux' as const, windowsStore: false };
    expect(canInstallUpdate({ ...options, appImage: undefined })).toBe(false);
    expect(
      canInstallUpdate({ ...options, appImage: 'relative.AppImage' })
    ).toBe(false);
    expect(canInstallUpdate({ ...options, appImage: image })).toBe(false);
    writeFileSync(image, 'image fixture');
    expect(canInstallUpdate({ ...options, appImage: image })).toBe(true);
    chmodSync(directory, 0o500);
    if (process.getuid?.() !== 0)
      expect(canInstallUpdate({ ...options, appImage: image })).toBe(false);
  });
  it('portable/unknown Windows layouts do not silently become NSIS installations', () => {
    const directory = temporary();
    const options = {
      platform: 'win32' as const,
      execPath: path.join(directory, 'Nota.exe'),
      windowsStore: false,
    };
    expect(canInstallUpdate(options)).toBe(false);
    writeFileSync(
      path.join(directory, 'Uninstall Nota.exe'),
      'uninstaller fixture'
    );
    expect(canInstallUpdate(options)).toBe(true);
    expect(canInstallUpdate({ ...options, windowsStore: true })).toBe(false);
    mkdirSync(path.join(directory, 'app-0.1.14'));
    writeFileSync(path.join(directory, 'Update.exe'), 'squirrel fixture');
    writeFileSync(
      path.join(directory, 'app-0.1.14', 'Uninstall Nota.exe'),
      'fixture'
    );
    expect(
      canInstallUpdate({
        ...options,
        execPath: path.join(directory, 'app-0.1.14/Nota.exe'),
      })
    ).toBe(false);
  });
  it('mounted macOS images are notification-only', () => {
    expect(
      canInstallUpdate({
        platform: 'darwin',
        execPath: '/Volumes/Nota/Nota.app/Contents/MacOS/Nota',
        windowsStore: false,
      })
    ).toBe(false);
    const directory = temporary();
    const bundle = path.join(directory, 'Nota.app');
    const binaryDir = path.join(bundle, 'Contents/MacOS');
    mkdirSync(binaryDir, { recursive: true });
    const execPath = path.join(binaryDir, 'Nota');
    writeFileSync(execPath, 'app fixture');
    const options = {
      platform: 'darwin' as const,
      execPath,
      windowsStore: false,
    };
    expect(canInstallUpdate(options)).toBe(true);
    chmodSync(bundle, 0o500);
    if (process.getuid?.() !== 0) expect(canInstallUpdate(options)).toBe(false);
    chmodSync(bundle, 0o700);
    expect(
      canInstallUpdate({
        ...options,
        execPath:
          '/private/var/folders/temporary/AppTranslocation/Nota.app/Contents/MacOS/Nota',
      })
    ).toBe(false);
  });
});
