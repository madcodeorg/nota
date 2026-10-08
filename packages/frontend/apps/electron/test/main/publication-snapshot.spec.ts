import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

const script = readFileSync(
  new URL(
    '../../../../../../scripts/prepare-publication-snapshot.sh',
    import.meta.url
  ),
  'utf8'
);
const exclusions = readFileSync(
  new URL(
    '../../../../../../scripts/publication-exclusions.json',
    import.meta.url
  ),
  'utf8'
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nota-publication-test-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@nota.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  mkdirSync(path.join(repo, 'scripts'));
  writeFileSync(
    path.join(repo, 'scripts/publication-exclusions.json'),
    exclusions
  );
  for (const file of [
    'source.txt',
    'libonnxruntime.1.17.1.dylib',
    'libsherpa-onnx-c-api.dylib',
  ]) {
    writeFileSync(path.join(repo, file), 'committed');
  }
  git('add', '.');
  git('commit', '-qm', 'fixture');
  writeFileSync(
    path.join(bin, 'gitleaks'),
    '#!/bin/sh\nexit "${SCAN_EXIT:-0}"\n',
    { mode: 0o755 }
  );
  const destination = path.join(root, 'candidate');
  const run = (scanExit = '0', workingTree = false, output = destination) =>
    execFileSync(
      'bash',
      [
        '-c',
        script,
        'snapshot',
        ...(workingTree ? ['--working-tree'] : []),
        output,
      ],
      {
        cwd: repo,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          SCAN_EXIT: scanExit,
        },
        stdio: 'pipe',
      }
    );
  return { repo, destination, git, run };
}

describe('source publication snapshot', () => {
  test('exports committed source only with independent history and no runtimes', () => {
    const { repo, destination, git, run } = fixture();
    const head = git('rev-parse', 'HEAD');
    writeFileSync(path.join(repo, 'source.txt'), 'dirty');
    writeFileSync(path.join(repo, 'private.txt'), 'untracked');
    run();
    expect(readFileSync(path.join(destination, 'source.txt'), 'utf8')).toBe(
      'committed'
    );
    for (const file of [
      'private.txt',
      'libonnxruntime.1.17.1.dylib',
      'libsherpa-onnx-c-api.dylib',
    ]) {
      expect(existsSync(path.join(destination, file))).toBe(false);
    }
    expect(
      execFileSync('git', ['-C', destination, 'rev-list', '--all', '--count'], {
        encoding: 'utf8',
      }).trim()
    ).toBe('1');
    expect(
      execFileSync('git', ['-C', destination, 'remote'], {
        encoding: 'utf8',
      }).trim()
    ).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(path.join(repo, 'source.txt'), 'utf8')).toBe('dirty');
    expect(existsSync(path.join(repo, 'libonnxruntime.1.17.1.dylib'))).toBe(
      true
    );
  });

  test('stops before initializing a repository when source scanning fails', () => {
    const { destination, run } = fixture();
    expect(() => run('1')).toThrow();
    expect(existsSync(path.join(destination, '.git'))).toBe(false);
  });

  test('rejects restricted committed source', () => {
    const { repo, destination, git, run } = fixture();
    mkdirSync(path.join(repo, 'packages/backend/server'), { recursive: true });
    writeFileSync(
      path.join(repo, 'packages/backend/server/state'),
      'restricted'
    );
    git('add', '.');
    git('commit', '-qm', 'forbidden');
    expect(() => run()).toThrow();
    expect(existsSync(path.join(destination, '.git'))).toBe(false);
  });

  test('working-tree export includes edits and new source while preserving deletions', () => {
    const { repo, destination, git, run } = fixture();
    const head = git('rev-parse', 'HEAD');
    writeFileSync(path.join(repo, 'source.txt'), 'dirty');
    writeFileSync(path.join(repo, 'new-test.ts'), 'export const test = true;');
    rmSync(path.join(repo, 'libsherpa-onnx-c-api.dylib'));
    writeFileSync(path.join(repo, 'deleted.txt'), 'tracked');
    git('add', 'deleted.txt');
    git('commit', '-qm', 'file to delete');
    const nextHead = git('rev-parse', 'HEAD');
    expect(nextHead).not.toBe(head);
    rmSync(path.join(repo, 'deleted.txt'));
    run('0', true);
    expect(readFileSync(path.join(destination, 'source.txt'), 'utf8')).toBe(
      'dirty'
    );
    expect(existsSync(path.join(destination, 'new-test.ts'))).toBe(true);
    expect(existsSync(path.join(destination, 'deleted.txt'))).toBe(false);
    expect(git('rev-parse', 'HEAD')).toBe(nextHead);
    expect(readFileSync(path.join(repo, 'source.txt'), 'utf8')).toBe('dirty');
  });

  test('omits tracked and untracked agent state, credentials, logs and generated files', () => {
    const { repo, destination, git, run } = fixture();
    const privatePaths = [
      '.claude/settings.local.json',
      'nested/.codex/session.json',
      '.nota/ai-settings.json',
      'nested/.env',
      'nested/.env.production',
      'nested/renderer.log',
      'nested/db.sqlite',
      'nested/db.sqlite-wal',
      'nested/nota.db-shm',
      'nested/storageState.json',
      'nested/model.onnx',
      'nested/signing.key',
      'nested/node_modules/package.json',
      'nested/dist/main.js',
      'AGENTS.md',
    ];
    expect(JSON.parse(exclusions).excludedPaths).toContain(':-');
    // A colon is an invalid filename on Windows; exercise that file on POSIX.
    if (process.platform !== 'win32') privatePaths.push(':-');
    for (const file of privatePaths) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), 'private');
    }
    git('add', '.');
    git('commit', '-qm', 'tracked private state fixture');
    mkdirSync(path.join(repo, 'nested/.claude'));
    writeFileSync(path.join(repo, 'nested/.claude/untracked.json'), 'private');
    writeFileSync(path.join(repo, 'nested/.env.example'), 'API_KEY=');
    run('0', true);
    for (const file of privatePaths)
      expect(existsSync(path.join(destination, file))).toBe(false);
    expect(existsSync(path.join(destination, 'nested/.claude'))).toBe(false);
    expect(existsSync(path.join(destination, 'nested/.env.example'))).toBe(
      true
    );
    expect(existsSync(path.join(repo, '.nota/ai-settings.json'))).toBe(true);
  });

  test('retains ignored tracked documentation in independent history', () => {
    const { repo, destination, git, run } = fixture();
    writeFileSync(path.join(repo, '.gitignore'), '/*.md\n');
    writeFileSync(path.join(repo, 'README.md'), '# Nota');
    git('add', '--force', 'README.md', '.gitignore');
    git('commit', '-qm', 'ignored tracked documentation');
    run();
    expect(
      execFileSync('git', ['-C', destination, 'ls-files', 'README.md'], {
        encoding: 'utf8',
      }).trim()
    ).toBe('README.md');
  });

  test('rejects source symlinks and destinations inside the source repository', () => {
    const { repo, destination, git, run } = fixture();
    expect(() => run('0', true, path.join(repo, 'candidate'))).toThrow();
    expect(existsSync(path.join(repo, 'candidate'))).toBe(false);
    symlinkSync('../outside-secret', path.join(repo, 'unsafe-link'));
    git('add', 'unsafe-link');
    git('commit', '-qm', 'symlink fixture');
    expect(() => run('0', true)).toThrow();
    expect(existsSync(path.join(destination, '.git'))).toBe(false);
  });

  test('refuses an existing directory or dangling symlink', () => {
    const { destination, run } = fixture();
    mkdirSync(destination);
    expect(() => run()).toThrow();
    rmSync(destination, { recursive: true });
    symlinkSync(`${destination}-missing`, destination);
    expect(() => run()).toThrow();
  });
});
