const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { resolveUpdateFile, findLatestDownload } = require('./updates.cjs');
const { buildManifest } = require('./make-update-manifest.cjs');

const root = path.resolve('/srv/updates');

test('resolves valid feed files', () => {
  assert.strictEqual(
    resolveUpdateFile('/updates/stable/latest-mac.yml', root),
    path.join(root, 'stable', 'latest-mac.yml')
  );
});

test('rejects traversal and unknown types', () => {
  for (const p of [
    '/updates/stable/../secret.yml',
    '/updates/stable/%2e%2e%2fx.yml',
    '/updates/../a.zip',
    '/updates/stable/notes.txt',
    '/updates/stable/sub/a.zip',
    '/updates/ST-able/a.zip',
  ]) {
    assert.strictEqual(resolveUpdateFile(p, root), null, p);
  }
});

test('manifest requires zip and carries hashes', () => {
  const f = { name: 'Nota-1.0.0-arm64.zip', size: 5, sha512: 'abc=' };
  const y = buildManifest('1.0.0', [f], '2026-01-01T00:00:00.000Z');
  assert.match(y, /version: 1.0.0/);
  assert.match(y, /sha512: abc=/);
  assert.throws(() => buildManifest('1.0.0', [{ ...f, name: 'a.dmg' }]));
});

test('download points at the dmg in the manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  assert.strictEqual(findLatestDownload('stable', dir), null);
  fs.mkdirSync(path.join(dir, 'stable'));
  fs.writeFileSync(
    path.join(dir, 'stable', 'latest-mac.yml'),
    'files:\n  - url: Nota-1.0.0.zip\n  - url: Nota-1.0.0.dmg\n'
  );
  assert.strictEqual(
    findLatestDownload('stable', dir),
    '/updates/stable/Nota-1.0.0.dmg'
  );
});
