import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const version = process.env.RELEASE_VERSION;
const type = process.env.BUILD_TYPE;
assert.ok(
  version && (type === 'beta' || type === 'stable'),
  'Release version/channel required'
);
const assets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const packages = [
  'macos-arm64.dmg',
  'macos-arm64.zip',
  'windows-x64.exe',
  'windows-x64.nsis.exe',
  'windows-x64.zip',
  'linux-x64.appimage',
  'linux-x64.deb',
  'linux-x64.zip',
];
const required = [
  ...packages.map(file => `nota-${version}-${type}-${file}`),
  'latest-mac.yml',
  'latest.yml',
  'latest-linux.yml',
];
for (const name of required) {
  const local = fs.readFileSync(path.join('release', name));
  const remote = assets.find(asset => asset.name === name);
  assert.ok(remote, `Uploaded release is missing ${name}`);
  assert.equal(remote.state, 'uploaded', `${name} has not finished uploading`);
  assert.equal(remote.size, local.length, `${name} upload size mismatch`);
  const digest = `sha256:${crypto.createHash('sha256').update(local).digest('hex')}`;
  assert.equal(
    remote.digest,
    digest,
    `${name} upload digest mismatch or unavailable`
  );
}
console.info(
  'All eight uploaded packages and three update feeds match their local bytes.'
);
