import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.join(process.cwd(), './release');
const version = process.env.RELEASE_VERSION ?? '0.0.0';
const entries = fs.readdirSync(releaseDir);
const platforms = {
  macos: { feed: 'latest-mac.yml', extensions: ['dmg', 'zip'], arch: 'arm64' },
  windows: { feed: 'latest.yml', extensions: ['nsis.exe'], arch: 'x64' },
  linux: {
    feed: 'latest-linux.yml',
    extensions: ['appimage', 'deb', 'zip'],
    arch: 'x64',
  },
};

if (process.argv?.includes('--require-all')) {
  const type = version.includes('-beta.') ? 'beta' : 'stable';
  for (const [platform, { arch, extensions }] of Object.entries(platforms)) {
    const packages =
      platform === 'windows' ? ['exe', 'nsis.exe', 'zip'] : extensions;
    for (const extension of packages) {
      const expected = `nota-${version}-${type}-${platform}-${arch}.${extension}`;
      if (
        !entries.includes(expected) ||
        fs.statSync(path.join(releaseDir, expected)).size === 0
      ) {
        throw new Error(`Incomplete release: missing or empty ${expected}`);
      }
    }
  }
}

// Build metadata in memory first; read/hash errors must never become a partial feed.
const feeds = [];
for (const [platform, { feed, extensions, arch }] of Object.entries(
  platforms
)) {
  const files = entries
    .filter(name =>
      extensions.some(extension =>
        name.toLowerCase().endsWith(`-${platform}-${arch}.${extension}`)
      )
    )
    .sort()
    .map(name => {
      const file = path.join(releaseDir, name);
      const data = fs.readFileSync(file);
      const size = fs.statSync(file).size;
      if (!size) throw new Error(`Empty update file: ${name}`);
      return {
        url: name,
        sha512: crypto.createHash('sha512').update(data).digest('base64'),
        size,
      };
    });
  if (!files.length) continue;
  const yaml =
    `version: ${version}\nfiles:\n` +
    files
      .map(
        file =>
          `  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}\n`
      )
      .join('') +
    `releaseDate: ${new Date().toISOString()}\n`;
  feeds.push([feed, yaml]);
}
for (const [feed, yaml] of feeds)
  fs.writeFileSync(path.join(releaseDir, feed), yaml);
