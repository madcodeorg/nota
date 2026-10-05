import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

import {
  assertPublicWebCrawlUrl,
  assertSafeShellArgs,
  executeSafeShellCommand,
  isForbiddenWebCrawlAddress,
  parseShellCommand,
} from './tools.js';

const execFileAsync = promisify(execFile);

describe('nota shell guard', () => {
  test('rejects write-capable find and sed commands', () => {
    expect(() =>
      assertSafeShellArgs(parseShellCommand('find . -delete'))
    ).toThrow(/Command not allowed/);
    expect(() =>
      assertSafeShellArgs(parseShellCommand('sed -i s/a/b/g file.md'))
    ).toThrow(/Command not allowed/);
  });

  test('allows read-only git subcommands and rejects write subcommands', () => {
    expect(() =>
      assertSafeShellArgs(parseShellCommand('git status --short'))
    ).not.toThrow();
    expect(() =>
      assertSafeShellArgs(parseShellCommand('git checkout main'))
    ).toThrow(/Git subcommand not allowed/);
  });

  test('rejects ripgrep external-command options in separated and equals forms', () => {
    for (const command of [
      'rg --pre rm needle note.md',
      'rg --pre=rm needle note.md',
      'rg --pre-glob *.md needle note.md',
      'rg --pre-glob=*.md needle note.md',
      'rg --hostname-bin rm needle note.md',
      'rg --hostname-bin=rm needle note.md',
      'rg -z needle archive.zip',
      'rg --search-zip needle archive.zip',
      'rg -nL needle linked-dir',
      'rg -fpatterns note.md',
      'rg -f/etc/passwd note.md',
    ]) {
      expect(() => assertSafeShellArgs(parseShellCommand(command))).toThrow(
        /preprocessors and external hostname commands|archive decompressors|pattern-file operands/
      );
    }
  });

  test('rejects Git execution hooks and output-file writes', () => {
    for (const command of [
      'git diff --ext-diff',
      'git diff --textconv',
      'git diff --output stolen.txt',
      'git diff --output=stolen.txt',
      'git grep -O rm needle',
      'git grep --open-files-in-pager=rm needle',
      'git show --show-signature HEAD',
      'git diff --help',
      'git diff -h',
      'git log --format=%G? -1',
      'git show --pretty=%GG HEAD',
      'git grep -fpatterns needle',
      'git grep -f/etc/passwd needle',
      'git ls-files -Xpatterns',
      'git ls-files -X/etc/passwd',
      'git diff -Opatterns',
      'git log -O/etc/passwd -1',
      'git show -Opatterns HEAD',
    ]) {
      expect(() => assertSafeShellArgs(parseShellCommand(command))).toThrow(
        /Git external commands, pagers, signatures, and output files|External file operands/
      );
    }
  });

  test('blocks shell mutations and symlink escapes while preserving read-only search', async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-shell-'));
    const workspace = path.join(testRoot, 'workspace');
    const outsideFile = path.join(testRoot, 'outside.txt');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'note.md'), 'safe needle\n');
    await writeFile(outsideFile, 'TOP_SECRET_[\n');
    await symlink(outsideFile, path.join(workspace, 'outside-link'));
    await symlink(outsideFile, path.join(workspace, 'patterns'));

    try {
      for (const command of [
        'rg --pre rm needle note.md',
        'rg --pre=rm needle note.md',
      ]) {
        await expect(
          executeSafeShellCommand({ command, root: workspace })
        ).rejects.toThrow(/preprocessors/);
        await expect(
          access(path.join(workspace, 'note.md'))
        ).resolves.toBeUndefined();
      }

      await expect(
        executeSafeShellCommand({
          command: 'cat outside-link',
          root: workspace,
        })
      ).rejects.toThrow(/paths must stay inside/);
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe(
        'TOP_SECRET_[\n'
      );

      const patternFileError = await executeSafeShellCommand({
        command: 'rg -fpatterns note.md',
        root: workspace,
      }).catch(error => error);
      expect(String(patternFileError)).toContain('pattern-file operands');
      expect(String(patternFileError)).not.toContain('TOP_SECRET_[');

      await expect(
        executeSafeShellCommand({
          command: 'rg needle note.md',
          root: workspace,
        })
      ).resolves.toMatchObject({ stdout: 'safe needle\n' });
    } finally {
      await rm(testRoot, { force: true, recursive: true });
    }
  });

  test('neutralizes repo and inherited Git diff executables', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'nota-shell-git-'));
    const marker = path.join(repo, 'external-diff-ran');
    const hook = path.join(repo, 'record-diff.sh');
    const originalExternalDiff = process.env.GIT_EXTERNAL_DIFF;
    const originalGitTrace = process.env.GIT_TRACE;
    const originalPath = process.env.PATH;
    const runGit = (args: string[]) =>
      execFileAsync('git', args, { cwd: repo, env: process.env });

    try {
      await runGit(['init', '--quiet']);
      await writeFile(
        hook,
        `#!/bin/sh\nprintf called > ${JSON.stringify(marker)}\nexit 0\n`
      );
      await chmod(hook, 0o755);
      await writeFile(path.join(repo, '.gitattributes'), '*.txt diff=nota\n');
      await writeFile(path.join(repo, 'note.txt'), 'before\n');
      await runGit(['add', '.gitattributes', 'note.txt']);
      await runGit([
        '-c',
        'commit.gpgSign=false',
        '-c',
        'user.email=nota@example.invalid',
        '-c',
        'user.name=Nota Test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ]);
      await writeFile(path.join(repo, 'note.txt'), 'after\n');
      await runGit(['config', 'diff.external', hook]);
      await runGit(['config', 'diff.nota.textconv', hook]);
      process.env.GIT_EXTERNAL_DIFF = hook;
      process.env.GIT_TRACE = marker;
      process.env.PATH = `${repo}${path.delimiter}${originalPath ?? ''}`;
      await writeFile(
        path.join(repo, 'rg'),
        `#!/bin/sh\nprintf called > ${JSON.stringify(marker)}\nexit 0\n`
      );
      await chmod(path.join(repo, 'rg'), 0o755);

      await expect(
        executeSafeShellCommand({ command: 'git diff', root: repo })
      ).resolves.toHaveProperty('stdout');
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        executeSafeShellCommand({ command: 'rg after note.txt', root: repo })
      ).resolves.toMatchObject({ stdout: 'after\n' });
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (originalExternalDiff === undefined) {
        delete process.env.GIT_EXTERNAL_DIFF;
      } else {
        process.env.GIT_EXTERNAL_DIFF = originalExternalDiff;
      }
      if (originalGitTrace === undefined) {
        delete process.env.GIT_TRACE;
      } else {
        process.env.GIT_TRACE = originalGitTrace;
      }
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      await rm(repo, { force: true, recursive: true });
    }
  });
});

describe('web crawl SSRF guard', () => {
  test('classifies local, private, link-local, and metadata addresses', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fc00::1',
      'fe80::1',
    ]) {
      expect(isForbiddenWebCrawlAddress(address), address).toBe(true);
    }

    expect(isForbiddenWebCrawlAddress('93.184.216.34')).toBe(false);
    expect(
      isForbiddenWebCrawlAddress('2606:2800:220:1:248:1893:25c8:1946')
    ).toBe(false);
  });

  test('rejects non-web protocols, non-default ports, and direct private IPs', async () => {
    await expect(
      assertPublicWebCrawlUrl(new URL('ftp://example.com'))
    ).rejects.toThrow(/Only http and https/);
    await expect(
      assertPublicWebCrawlUrl(new URL('https://example.com:8443/path'))
    ).rejects.toThrow(/default http and https ports/);
    await expect(
      assertPublicWebCrawlUrl(new URL('http://127.0.0.1'))
    ).rejects.toThrow(/private address/);
  });
});
