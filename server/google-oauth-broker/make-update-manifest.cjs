#!/usr/bin/env node
// Usage: node make-update-manifest.cjs <channel-dir> <version> <file>...
// Writes latest-mac.yml (zip is required by Squirrel.Mac) with sha512 hashes.
// Run after the signed+notarized zip/dmg are copied into <channel-dir>.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function buildManifest(version, files, releaseDate = new Date().toISOString()) {
  const entries = files.map(({ name, size, sha512 }) =>
    [`  - url: ${name}`, `    sha512: ${sha512}`, `    size: ${size}`].join(
      '\n'
    )
  );
  const zip = files.find(f => f.name.endsWith('.zip'));
  if (!zip) throw new Error('A .zip artifact is required for macOS updates');
  return [
    `version: ${version}`,
    'files:',
    ...entries,
    `path: ${zip.name}`,
    `sha512: ${zip.sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');
}

function describeFile(filePath) {
  const data = fs.readFileSync(filePath);
  return {
    name: path.basename(filePath),
    size: data.length,
    sha512: crypto.createHash('sha512').update(data).digest('base64'),
  };
}

if (require.main === module) {
  const [dir, version, ...names] = process.argv.slice(2);
  if (!dir || !version || names.length === 0) {
    console.error('Usage: make-update-manifest.cjs <dir> <version> <file>...');
    process.exit(1);
  }
  const files = names.map(n => describeFile(path.join(dir, n)));
  fs.writeFileSync(
    path.join(dir, 'latest-mac.yml'),
    buildManifest(version, files)
  );
}

module.exports = { buildManifest, describeFile };
