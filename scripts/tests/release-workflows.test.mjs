import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const source = file => readFileSync(path.join(root, file), 'utf8');
const yaml = file => parse(source(file));
const temporary = t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nota-release-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

void test('tag and branch beta/stable releases always build and require all platforms', () => {
  const tag = yaml('.github/workflows/release-on-tag.yml');
  assert.match(tag.jobs.dispatch.steps[0].run, /gh workflow run release.yml/);
  const manual = yaml('.github/workflows/release.yml');
  assert.deepEqual(Object.keys(manual.on.workflow_dispatch.inputs), [
    'version',
  ]);
  for (const platform of ['macos', 'windows', 'linux']) {
    assert.equal(manual.jobs.desktop.with[`desktop_${platform}`], true);
  }
  assert.equal(manual.concurrency['cancel-in-progress'], false);
  const release = yaml('.github/workflows/release-desktop.yml');
  assert.equal(
    release.jobs['make-distribution-linux'].strategy.matrix.spec[0].runner,
    'ubuntu-22.04'
  );
  assert.match(release.jobs.release.if, /!cancelled\(\)/);
  assert.doesNotMatch(release.jobs.release.if, /\|\|/);
  assert.match(
    release.jobs.release.if,
    /needs\.make-distribution-macos\.result == 'success'/
  );
  assert.match(
    release.jobs.release.if,
    /needs\.finalize-installer-windows\.result == 'success'/
  );
  assert.ok(
    release.jobs.release.steps.some(step =>
      step.run?.includes('generate-release-yml.mjs --require-all')
    )
  );
  assert.match(
    release.jobs.release.if,
    /needs\.make-distribution-linux\.result == 'success'/
  );
  const publish = release.jobs.release.steps.find(step =>
    step.uses?.startsWith('softprops/action-gh-release')
  );
  assert.equal(publish.with.target_commitish, '${{ github.sha }}');
  assert.equal(publish.with.draft, true);
  const verification = release.jobs.release.steps.findIndex(
    step => step.name === 'Verify uploaded packages and feeds'
  );
  const publication = release.jobs.release.steps.findIndex(
    step => step.name === 'Publish complete beta'
  );
  assert.ok(verification >= 0 && publication > verification);
  assert.equal(
    release.jobs.release.steps[publication].if,
    "${{ inputs.build-type == 'beta' }}"
  );
});

void test('Linux installs tools before compilation and builds, validates and attests three formats', () => {
  const workflow = yaml('.github/workflows/release-desktop-platform.yml');
  const steps = workflow.jobs.build.steps;
  const setupIndex = steps.findIndex(
    step => step.name === 'Setup Linux build tools'
  );
  assert.ok(setupIndex >= 0);
  assert.ok(
    setupIndex < steps.findIndex(step => step.name === 'Build Nota native')
  );
  assert.ok(
    setupIndex < steps.findIndex(step => step.name === 'Build Desktop Layers')
  );
  const tools = source('.github/actions/setup-linux-desktop/action.yml');
  for (const tool of [
    'clang',
    'cmake',
    'fakeroot',
    'dpkg',
    'squashfs-tools',
    'zip',
    'xvfb',
    'xauth',
  ])
    assert.ok(tools.includes(tool));
  assert.ok(tools.includes('CXX=g++-11'));
  const make = steps.find(step => step.name === 'make');
  assert.match(
    make.run,
    /--targets=@electron-forge\/maker-zip,@reforged\/maker-appimage,@electron-forge\/maker-deb/
  );
  assert.doesNotMatch(
    source('.github/workflows/release-desktop-platform.yml'),
    /\.flatpak|apt-get.*purge/
  );
  const smoke = steps.find(
    step => step.name === 'Validate and smoke-test Linux installers'
  );
  assert.equal(smoke['continue-on-error'], undefined);
  assert.match(smoke.run, /validate-linux-release\.sh/);
  const validation = source('scripts/validate-linux-release.sh');
  assert.match(validation, /unzip -t/);
  assert.match(validation, /dpkg-deb --field.*Version/);
  assert.match(validation, /--appimage-extract-and-run/);
  assert.match(validation, /apt-get install.*--no-install-recommends/);
  assert.doesNotMatch(validation, /--no-sandbox/);
  const removalIndex = validation.indexOf(
    'sudo dpkg --remove "$package"\ntest ! -e "$metainfo"'
  );
  assert.ok(removalIndex >= 0);
  assert.ok(
    removalIndex <
      validation.indexOf(
        "printf 'Linux ZIP, AppImage and Debian smoke tests passed"
      )
  );
  assert.ok(validation.includes('test -s "$metainfo"'));
  assert.ok(validation.includes("binary.read(4) == b'\\x7fELF'"));
  assert.ok(validation.includes('limit=3.4.30'));
  assert.ok(validation.includes('limit=2.35'));
  const ci = yaml('.github/workflows/ci.yml');
  assert.ok(
    ci.jobs['unit-test'].steps.some(
      step => step.run === 'node --test scripts/tests/*.test.mjs'
    )
  );
});

void test('Linux native and helper caches are baseline-scoped in both exact and fallback keys', () => {
  const helpers = yaml('.github/actions/local-asr-cache/action.yml').runs.steps;
  const cache = helpers.find(step => step.uses?.startsWith('actions/cache'));
  assert.match(cache.with.key, /steps\.baseline\.outputs\.suffix/);
  assert.match(cache.with['restore-keys'], /steps\.baseline\.outputs\.suffix/);
  assert.ok(helpers.some(step => step.run?.includes('/etc/os-release')));
  const rust = yaml('.github/actions/build-rust/action.yml').runs.steps;
  const linux = rust.find(
    step =>
      step.uses?.startsWith('Swatinem/rust-cache') &&
      step.if.includes("!= 'Windows'")
  );
  assert.match(linux.with['shared-key'], /steps\.baseline\.outputs\.suffix/);
  const warmer = yaml('.github/workflows/warm-caches.yml').jobs.build;
  const matrix = warmer.strategy.matrix.include;
  assert.ok(
    matrix.some(
      entry => entry.platform === 'linux' && entry.runner === 'ubuntu-22.04'
    )
  );
  assert.ok(
    warmer.steps.some(
      step => step.uses === './.github/actions/setup-linux-desktop'
    )
  );
});

void test('Debian lifecycle scripts use only their own package metadata and tolerate repeat removal', t => {
  const dir = temporary(t);
  for (const command of ['install', 'rm'])
    writeFileSync(path.join(dir, command), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o755,
    });
  for (const name of ['nota', 'nota-beta', 'nota-canary']) {
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      DPKG_MAINTSCRIPT_PACKAGE: name,
    };
    const install = spawnSync(
      'sh',
      [
        path.join(
          root,
          'packages/frontend/apps/electron/resources/deb/postinst'
        ),
      ],
      { env, encoding: 'utf8' }
    );
    assert.equal(install.status, 0, install.stderr);
    assert.deepEqual(install.stdout.trim().split('\n'), [
      '-Dm0644',
      `/usr/lib/${name}/resources/nota.metainfo.xml`,
      `/usr/share/metainfo/${name}.metainfo.xml`,
    ]);
    for (let repeat = 0; repeat < 2; repeat++) {
      const remove = spawnSync(
        'sh',
        [
          path.join(
            root,
            'packages/frontend/apps/electron/resources/deb/prerm'
          ),
        ],
        { env, encoding: 'utf8' }
      );
      assert.equal(remove.status, 0, remove.stderr);
      assert.deepEqual(remove.stdout.trim().split('\n'), [
        '-f',
        `/usr/share/metainfo/${name}.metainfo.xml`,
      ]);
    }
  }
});

const release = (version, prerelease, date, platforms) => ({
  tag_name: `v${version}`,
  prerelease,
  draft: false,
  published_at: date,
  assets: platforms.flatMap(([platform, ext, feed]) => [
    { name: feed },
    {
      name: `nota-${version}-${prerelease ? 'beta' : 'stable'}-${platform}-${platform === 'macos' ? 'arm64' : 'x64'}.${ext}`,
    },
  ]),
});
const mac = ['macos', 'zip', 'latest-mac.yml'];
const win = ['windows', 'nsis.exe', 'latest.yml'];
const linux = ['linux', 'appimage', 'latest-linux.yml'];
const older = release('0.1.13-beta.3', true, '2026-11-03', [mac, win]);
const newer = release('0.1.14-beta.1', true, '2026-11-05', [linux]);
const canary = release('2026.11.6-canary.1000', true, '2026-11-06', [linux]);
const stable = release('0.1.13', false, '2026-11-04', [mac, win]);
const releases = [older, newer, canary, stable];

function feedFixture(t, corrupt = false, records = releases) {
  const dir = temporary(t);
  const bin = path.join(dir, 'bin');
  const runner = path.join(dir, 'runner');
  mkdirSync(bin);
  mkdirSync(runner);
  writeFileSync(
    path.join(runner, 'site-releases.json'),
    JSON.stringify(records)
  );
  const feeds = {};
  for (const item of records) {
    for (const asset of item.assets.filter(file =>
      file.name.startsWith('latest')
    )) {
      const platform =
        asset.name === 'latest-mac.yml'
          ? 'macos'
          : asset.name === 'latest-linux.yml'
            ? 'linux'
            : 'windows';
      const file = item.assets.find(file =>
        file.name.includes(`-${platform}-`)
      );
      feeds[`${item.tag_name}/${asset.name}`] =
        `version: ${corrupt ? '0.0.0' : item.tag_name.slice(1)}\nfiles:\n  - url: ${file.name}\n    sha512: synthetic\n    size: 1\n`;
    }
  }
  writeFileSync(
    path.join(bin, 'gh'),
    '#!/usr/bin/env node\nconst fs=require("node:fs"),path=require("node:path"); const args=process.argv.slice(2),tag=args[2],feed=args[args.indexOf("--pattern")+1],dir=args[args.indexOf("--dir")+1]; fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,feed),JSON.parse(process.env.FIXTURE_FEEDS)[`${tag}/${feed}`]);\n',
    { mode: 0o755 }
  );
  return {
    dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: runner,
      GITHUB_REPOSITORY: 'madcodeorg/nota',
      FIXTURE_FEEDS: JSON.stringify(feeds),
    },
  };
}

void test('partial Linux beta preserves older macOS/Windows beta feeds and excludes newer canaries', t => {
  const fixture = feedFixture(t);
  const result = spawnSync(
    'bash',
    [path.join(root, 'scripts/site-release-feeds.sh'), 'beta'],
    { cwd: fixture.dir, env: fixture.env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  for (const [feed, version] of [
    ['latest-mac.yml', older.tag_name],
    ['latest.yml', older.tag_name],
    ['latest-linux.yml', newer.tag_name],
  ]) {
    const manifest = readFileSync(
      path.join(fixture.dir, '_site/updates/beta', feed),
      'utf8'
    );
    assert.ok(
      manifest.includes(
        `https://github.com/madcodeorg/nota/releases/download/${version}/nota-`
      )
    );
    assert.ok(!manifest.includes('canary'));
  }
});

void test('stable feeds are unchanged by Linux-only beta/canary releases', t => {
  const fixture = feedFixture(t);
  const result = spawnSync(
    'bash',
    [path.join(root, 'scripts/site-release-feeds.sh'), 'stable'],
    { cwd: fixture.dir, env: fixture.env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  for (const feed of ['latest-mac.yml', 'latest.yml'])
    assert.match(
      readFileSync(
        path.join(fixture.dir, '_site/updates/stable', feed),
        'utf8'
      ),
      /version: 0\.1\.13/
    );
  assert.match(result.stdout, /No published stable linux update feed/);
});

void test('feed version mismatches fail deployment rather than advertising the wrong build', t => {
  const fixture = feedFixture(t, true);
  const result = spawnSync(
    'bash',
    [path.join(root, 'scripts/site-release-feeds.sh'), 'beta'],
    { cwd: fixture.dir, env: fixture.env, encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version mismatch/);
});

void test('a DMG-only macOS release cannot replace a usable ZIP update feed', t => {
  const dmgOnly = release('0.1.14-beta.2', true, '2026-11-08', [
    ['macos', 'dmg', 'latest-mac.yml'],
  ]);
  const fixture = feedFixture(t, false, [...releases, dmgOnly]);
  const result = spawnSync(
    'bash',
    [path.join(root, 'scripts/site-release-feeds.sh'), 'beta'],
    { cwd: fixture.dir, env: fixture.env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    readFileSync(
      path.join(fixture.dir, '_site/updates/beta/latest-mac.yml'),
      'utf8'
    ).includes(older.tag_name)
  );
});
