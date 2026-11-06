import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

// Checking is supported for every package. Installation needs positive evidence
// that replacing this installation is safe; unknown/portable layouts notify only.
export function canInstallUpdate({
  platform = process.platform,
  execPath = process.execPath,
  appImage = process.env.APPIMAGE,
  windowsStore = process.windowsStore,
}: {
  platform?: NodeJS.Platform;
  execPath?: string;
  appImage?: string;
  windowsStore?: boolean;
} = {}): boolean {
  if (windowsStore) return false;
  if (platform === 'darwin') {
    try {
      const resolved = realpathSync(execPath);
      if (
        resolved.startsWith('/Volumes/') ||
        resolved.includes('/AppTranslocation/')
      )
        return false;
      let bundle = path.dirname(resolved);
      while (!bundle.endsWith('.app') && bundle !== path.dirname(bundle))
        bundle = path.dirname(bundle);
      if (!bundle.endsWith('.app')) return false;
      accessSync(bundle, constants.W_OK);
      accessSync(path.dirname(bundle), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  if (platform === 'linux') {
    if (!appImage || !path.isAbsolute(appImage) || appImage.includes('\0'))
      return false;
    try {
      if (!statSync(appImage).isFile()) return false;
      accessSync(appImage, constants.R_OK);
      accessSync(path.dirname(appImage), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  if (platform === 'win32') {
    const directory = path.dirname(execPath);
    // Squirrel's Update.exe is above its versioned application directory.
    if (existsSync(path.join(directory, '..', 'Update.exe'))) return false;
    try {
      return readdirSync(directory).some(
        name =>
          /^Uninstall .+\.exe$/i.test(name) &&
          statSync(path.join(directory, name)).isFile()
      );
    } catch {
      return false;
    }
  }
  return false;
}
