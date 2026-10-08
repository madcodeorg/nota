import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { arch as makeArch } from './make-env.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const electronDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const rootDir = path.resolve(electronDir, '../../../..');
const packageDir = path.join(electronDir, 'native', 'apple-calendar-native');
const resourceDir = path.join(electronDir, 'resources', 'native');
const binaryBaseName = 'nota-calendar-native';
const targetArch = process.env.NOTA_ELECTRON_TARGET_ARCH ?? makeArch;

export async function verifyCalendarNativeBinding(binaryPath: string) {
  // Load only: never request access or read the user's calendar during a build.
  await execFileAsync(
    process.execPath,
    [
      '-e',
      `const assert = require('node:assert/strict');
const binding = require(process.argv[1]);
for (const name of ['getAppleCalendarStatus', 'requestAppleCalendarAccess', 'listAppleCalendars', 'listAppleCalendarEvents']) {
  assert.equal(typeof binding[name], 'function', 'Missing Calendar native API: ' + name);
}`,
      binaryPath,
    ],
    { cwd: rootDir, maxBuffer: 1024 * 1024 }
  );
}

function napiBinaryPath() {
  return path.join(
    path.dirname(require.resolve('@napi-rs/cli/package.json')),
    'dist',
    'cli.js'
  );
}

function rustTargetTriple() {
  if (targetArch === 'arm64') {
    return 'aarch64-apple-darwin';
  }
  if (targetArch === 'x64') {
    return 'x86_64-apple-darwin';
  }
  return null;
}

function nativeBinarySuffix() {
  if (targetArch === 'arm64') {
    return 'darwin-arm64';
  }
  if (targetArch === 'x64') {
    return 'darwin-x64';
  }
  return null;
}

async function findBuiltBinary(outputDir: string) {
  const suffix = nativeBinarySuffix();
  const expected = suffix
    ? path.join(outputDir, `${binaryBaseName}.${suffix}.node`)
    : null;

  if (expected) {
    try {
      await fs.access(expected);
      return expected;
    } catch {
      // Fall through and scan the temporary output directory.
    }
  }

  const files = await fs.readdir(outputDir);
  const built = files.find(
    file => file.startsWith(`${binaryBaseName}.`) && file.endsWith('.node')
  );
  if (!built) {
    throw new Error('Apple Calendar native binding was not built.');
  }
  return path.join(outputDir, built);
}

export async function buildAppleCalendarNative() {
  if (process.platform !== 'darwin') {
    return {
      built: false,
      reason: 'Apple Calendar native binding is macOS-only.',
    };
  }

  const target = rustTargetTriple();
  if (!target) {
    return {
      built: false,
      reason: `Apple Calendar native binding is not supported for ${targetArch}.`,
    };
  }

  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'nota-apple-calendar-native-')
  );
  try {
    await execFileAsync(
      process.execPath,
      [
        napiBinaryPath(),
        'build',
        '-p',
        'nota_apple_calendar_native',
        '--target',
        target,
        '--platform',
        '--release',
        '--no-js',
        '--manifest-path',
        path.join(packageDir, 'Cargo.toml'),
        '--package-json-path',
        path.join(packageDir, 'package.json'),
        '--output-dir',
        outputDir,
      ],
      {
        cwd: rootDir,
        maxBuffer: 1024 * 1024 * 16,
      }
    );

    const builtBinaryPath = await findBuiltBinary(outputDir);
    if (targetArch === process.arch) {
      await verifyCalendarNativeBinding(builtBinaryPath);
    }
    const destinationPath = path.join(
      resourceDir,
      path.basename(builtBinaryPath)
    );
    await fs.mkdir(resourceDir, { recursive: true });
    await fs.copyFile(builtBinaryPath, destinationPath);
    await fs.chmod(destinationPath, 0o755);

    return {
      built: true,
      path: destinationPath,
    };
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await buildAppleCalendarNative();
  console.log(
    result.built
      ? `Apple Calendar native binding built at ${result.path}`
      : result.reason
  );
}
