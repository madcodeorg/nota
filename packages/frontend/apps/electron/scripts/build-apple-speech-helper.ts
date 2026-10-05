import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { arch as makeArch } from './make-env.js';

const execFileAsync = promisify(execFile);
const electronDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const helperName = 'nota-apple-speech-helper';
const helperPackageDir = path.join(
  electronDir,
  'native',
  'apple-speech-helper'
);
const helperResourcePath = path.join(
  electronDir,
  'resources',
  'native',
  helperName
);
const targetArch = process.env.NOTA_ELECTRON_TARGET_ARCH ?? makeArch;

type BuildAppleSpeechHelperOptions = {
  optional?: boolean;
};

function shouldBuildAppleSpeechHelper(options: BuildAppleSpeechHelperOptions) {
  const setting = process.env.NOTA_ENABLE_APPLE_SPEECH_HELPER;
  if (setting === '1') {
    return true;
  }
  if (setting === '0') {
    return false;
  }
  return options.optional !== true;
}

async function removePackagedAppleSpeechHelper() {
  await fs.rm(helperResourcePath, { force: true });
}

function swiftBuildTriple() {
  if (targetArch === 'arm64') {
    return 'arm64-apple-macosx';
  }
  if (targetArch === 'x64') {
    return 'x86_64-apple-macosx';
  }
  return null;
}

function swiftBuildTargetArgs() {
  const triple = swiftBuildTriple();
  return triple ? ['--triple', triple] : [];
}

export async function buildAppleSpeechHelper(
  options: BuildAppleSpeechHelperOptions = {}
) {
  if (!shouldBuildAppleSpeechHelper(options)) {
    await removePackagedAppleSpeechHelper();
    return {
      built: false,
      reason:
        'Apple Speech helper skipped. Set NOTA_ENABLE_APPLE_SPEECH_HELPER=1 to include the macOS 26 SpeechAnalyzer helper.',
    };
  }

  if (process.platform !== 'darwin') {
    await removePackagedAppleSpeechHelper();
    return {
      built: false,
      reason: 'Apple Speech helper is macOS-only.',
    };
  }

  await execFileAsync('swift', [
    'build',
    '--package-path',
    helperPackageDir,
    '-c',
    'release',
    ...swiftBuildTargetArgs(),
  ]);
  // SwiftPM can use either the native or Xcode build layout. Ask it for the
  // active output directory so an old .build/<triple> binary is never packaged.
  const { stdout } = await execFileAsync('swift', [
    'build',
    '--package-path',
    helperPackageDir,
    '-c',
    'release',
    ...swiftBuildTargetArgs(),
    '--show-bin-path',
  ]);
  const helperBinaryPath = path.join(stdout.trim(), helperName);
  await fs.access(helperBinaryPath);
  await fs.mkdir(path.dirname(helperResourcePath), { recursive: true });
  await fs.copyFile(helperBinaryPath, helperResourcePath);
  await fs.chmod(helperResourcePath, 0o755);
  return {
    built: true,
    path: helperResourcePath,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await buildAppleSpeechHelper();
  console.log(
    result.built ? `Apple Speech helper built at ${result.path}` : result.reason
  );
}
