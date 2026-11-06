import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const action = parse(
  readFileSync(
    path.join(root, '.github/actions/prepare-release/action.yml'),
    'utf8'
  )
);
const temporary = t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nota-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

void test('branch releases require explicit semantic versions; tags preserve their versions', t => {
  const dir = temporary(t);
  for (const [version, refType, refName, expected] of [
    ['0.1.14-beta.1', 'branch', 'beta', 'beta'],
    ['0.1.14', 'branch', 'main', 'stable'],
    ['', 'tag', 'v0.1.14-beta.2', 'beta'],
    ['', 'tag', 'v0.1.14', 'stable'],
    ['', 'branch', 'beta', null],
    ['0.1.14', 'branch', 'beta', null],
    ['0.1.14-beta.1', 'branch', 'feature', null],
    ['0.1.14-beta.0', 'branch', 'beta', null],
    ['0.01.14-beta.1', 'branch', 'beta', null],
    ['2026.11.6-canary.201', 'branch', 'beta', null],
    ['0.1.14-beta.1', 'tag', 'v0.1.14-beta.2', null],
  ]) {
    const output = path.join(dir, 'outputs');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', action.runs.steps[0].run], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        REQUESTED_VERSION: version,
        GITHUB_REF_TYPE: refType,
        GITHUB_REF_NAME: refName,
        GITHUB_OUTPUT: output,
      },
    });
    if (expected) {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        readFileSync(output, 'utf8').includes(`BUILD_TYPE=${expected}`)
      );
      assert.ok(
        readFileSync(output, 'utf8').includes(
          `APP_VERSION=${refType === 'tag' ? refName.slice(1) : version}`
        )
      );
    } else
      assert.notEqual(result.status, 0, `${version}/${refName} should fail`);
  }
});

void test('published versions and tags for a different commit cannot be overwritten', t => {
  const dir = temporary(t);
  const gh = path.join(dir, 'gh');
  writeFileSync(
    gh,
    '#!/usr/bin/env node\nconst args=process.argv; if(args.some(x=>x.includes("matching-refs"))) console.log(process.env.REF_FIXTURE); else if(args.some(x=>x.includes("/compare/"))) console.log(process.env.COMPARE_FIXTURE || "identical"); else console.log(process.env.RELEASE_FIXTURE);\n',
    { mode: 0o755 }
  );
  for (const [published, sha, expected] of [
    [false, 'current', 0],
    [true, 'current', 1],
    [false, 'other', 1],
  ]) {
    const result = spawnSync(
      'bash',
      [path.join(root, 'scripts/check-release-version.sh')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'test/nota',
          GITHUB_SHA: 'current',
          RELEASE_VERSION: '0.1.14-beta.1',
          REF_FIXTURE: JSON.stringify([
            {
              ref: 'refs/tags/v0.1.14-beta.1',
              object: { type: 'commit', sha },
            },
          ]),
          RELEASE_FIXTURE: JSON.stringify({
            tag_name: 'v0.1.14-beta.1',
            draft: !published,
          }),
        },
      }
    );
    assert.equal(result.status, expected, result.stderr);
  }
});

void test('stable payload compares beta trees, allowing only release metadata drift', t => {
  const dir = temporary(t);
  writeFileSync(
    path.join(dir, 'gh'),
    '#!/usr/bin/env node\nconst a=process.argv; if(a.some(x=>x.includes("/compare/"))) console.log("identical"); else if(a.some(x=>x.includes("matching-refs"))) console.log("[]"); else if(a.some(x=>x.includes("git/ref/tags/"))) console.log(JSON.stringify({type:"commit",sha:"beta-source"})); else console.log(JSON.stringify({tag_name:"v0.1.14-beta.1",prerelease:true,draft:false,published_at:"2026-11-06"}));\n',
    { mode: 0o755 }
  );
  writeFileSync(
    path.join(dir, 'git'),
    '#!/usr/bin/env node\nif(process.argv[2]==="diff") console.log((process.env.DRIFT||"").split("\\n").filter(x=>x && !process.argv.includes(":!"+x)).join("\\n"));\n',
    { mode: 0o755 }
  );
  for (const [drift, expected] of [
    ['', 0],
    ['CHANGELOG.md', 0],
    ['packages/frontend/core/src/index.ts', 1],
  ]) {
    const result = spawnSync(
      'bash',
      [path.join(root, 'scripts/check-release-version.sh')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'test/nota',
          GITHUB_SHA: 'main-source',
          RELEASE_VERSION: '0.1.14',
          DRIFT: drift,
        },
      }
    );
    assert.equal(result.status, expected, result.stderr);
    if (expected) assert.ok(result.stderr.includes('Stable payload differs'));
  }
});

void test('uploaded assets must contain matching bytes before publishing the beta', t => {
  const dir = temporary(t);
  mkdirSync(path.join(dir, 'release'));
  const version = '0.1.14-beta.1';
  const names = [
    'macos-arm64.dmg',
    'macos-arm64.zip',
    'windows-x64.exe',
    'windows-x64.nsis.exe',
    'windows-x64.zip',
    'linux-x64.appimage',
    'linux-x64.deb',
    'linux-x64.zip',
  ]
    .map(file => `nota-${version}-beta-${file}`)
    .concat(['latest-mac.yml', 'latest.yml', 'latest-linux.yml']);
  const bytes = Buffer.from('uploaded fixture');
  const assets = names.map(name => {
    writeFileSync(path.join(dir, 'release', name), bytes);
    return {
      name,
      state: 'uploaded',
      size: bytes.length,
      digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    };
  });
  const metadata = path.join(dir, 'assets.json');
  const run = items => {
    writeFileSync(metadata, JSON.stringify(items));
    return spawnSync(
      process.execPath,
      [path.join(root, 'scripts/verify-release-assets.mjs'), metadata],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, RELEASE_VERSION: version, BUILD_TYPE: 'beta' },
      }
    );
  };
  assert.equal(run(assets).status, 0);
  assert.notEqual(run(assets.slice(1)).status, 0);
  assert.notEqual(
    run([{ ...assets[0], digest: 'sha256:wrong' }, ...assets.slice(1)]).status,
    0
  );
});

void test('all eight packages must exist before any update manifests are generated', t => {
  const dir = temporary(t);
  const release = path.join(dir, 'release');
  mkdirSync(release);
  const files = [
    'macos-arm64.dmg',
    'macos-arm64.zip',
    'windows-x64.exe',
    'windows-x64.nsis.exe',
    'windows-x64.zip',
    'linux-x64.appimage',
    'linux-x64.deb',
    'linux-x64.zip',
  ];
  const version = '0.1.14-beta.1';
  const names = files.map(file => `nota-${version}-beta-${file}`);
  for (const name of names)
    writeFileSync(path.join(release, name), 'package fixture');
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(root, 'scripts/generate-release-yml.mjs'), '--require-all'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, RELEASE_VERSION: version },
      }
    );
  assert.equal(run().status, 0);
  for (const name of ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']) {
    const feed = readFileSync(path.join(release, name), 'utf8');
    assert.ok(feed.includes(`version: ${version}`));
    if (name === 'latest.yml') {
      assert.ok(feed.includes('.nsis.exe'));
      assert.ok(!feed.includes('.zip'));
    }
    rmSync(path.join(release, name));
  }
  for (const name of names) {
    rmSync(path.join(release, name));
    const result = run();
    assert.notEqual(result.status, 0, `${name} must be required`);
    assert.ok(result.stderr.includes('Incomplete release'));
    writeFileSync(path.join(release, name), 'package fixture');
  }
});
