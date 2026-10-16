import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.join(process.cwd(), './release');

// electron-updater reads latest.yml on Windows, latest-mac.yml on macOS and
// latest-linux.yml on Linux.
const filenamesMapping = {
  windows: 'latest.yml',
  macos: 'latest-mac.yml',
  linux: 'latest-linux.yml',
};

const releaseFiles = ['zip', 'exe', 'dmg', 'appimage', 'deb', 'flatpak'];

const generateYml = platform => {
  const yml = {
    version: process.env.RELEASE_VERSION ?? '0.0.0',
    files: [],
  };

  const regex =
    // The Windows updater is NsisUpdater and takes the first .exe in the feed,
    // so list only the NSIS installer, not the Squirrel one or the zip.
    platform === 'windows'
      ? /.+-windows-.+\.nsis\.exe$/
      : new RegExp(`.+-${platform}-.+.(${releaseFiles.join('|')})$`);

  const files = fs.readdirSync(releaseDir).filter(file => regex.test(file));
  const outputFileName = filenamesMapping[platform];

  console.info(`Release content for ${platform}:`);
  console.info(JSON.stringify(files, null, 2), '\n');

  // A feed with no files would make that platform's updater fail on a release
  // that did not build it.
  if (files.length === 0) return;

  files.forEach(fileName => {
    const filePath = path.join(releaseDir, fileName);
    try {
      const fileData = fs.readFileSync(filePath);
      const hash = crypto
        .createHash('sha512')
        .update(fileData)
        .digest('base64');
      const size = fs.statSync(filePath).size;

      yml.files.push({
        url: fileName,
        sha512: hash,
        size: size,
      });
    } catch {}
  });
  yml.releaseDate = new Date().toISOString();

  // NOTE(@forehalo): make sure old windows x64 won't fetch windows arm64 by default
  // maybe we need to separate arm64 builds to separated yml file `latest-arm64.yml`, `latest-linux-arm64.yml`
  // check https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/Provider.ts#L30
  // and packages/frontend/apps/electron/src/main/updater/affine-update-provider.ts#L100
  yml.files.sort(a => (a.url.includes('windows-arm64') ? 1 : -1));

  const ymlStr =
    `version: ${yml.version}\n` +
    `files:\n` +
    yml.files
      .map(file => {
        return (
          `  - url: ${file.url}\n` +
          `    sha512: ${file.sha512}\n` +
          `    size: ${file.size}\n`
        );
      })
      .join('') +
    `releaseDate: ${yml.releaseDate}\n`;

  fs.writeFileSync(path.join(releaseDir, outputFileName), ymlStr);
};

generateYml('macos');
generateYml('linux');
generateYml('windows');
