import fs from 'node:fs/promises';
import path from 'node:path';

import * as esbuild from 'esbuild';

import { buildAppleCalendarNative } from './build-apple-calendar-native';
import { buildAppleSpeechHelper } from './build-apple-speech-helper';
import { buildLocalAsr } from './build-local-asr';
import { aiBackendConfig, config, electronDir, mode, rootDir } from './common';

// Bundle the local AI backend (the Express server normally run via `tsx` in
// dev) into a single CJS file shipped next to main.js, so the packaged desktop
// app can spawn it instead of reaching for a non-existent cloud backend.
// The heavy native deps (@huggingface/transformers, onnxruntime-*) are loaded
// lazily via `new Function('return import(...)')`, so esbuild never tries to
// bundle them — they only matter at inference time and stay external.
async function buildAiBackend() {
  await esbuild.build(aiBackendConfig());
}

async function buildNativeHelpers() {
  await Promise.all([
    fs.rm(path.join(electronDir, 'native/apple-calendar-helper'), {
      force: true,
      recursive: true,
    }),
    fs.rm(path.join(electronDir, 'resources/native/Nota Calendar Helper.app'), {
      force: true,
      recursive: true,
    }),
    fs.rm(
      path.join(electronDir, 'resources/native/nota-apple-calendar-helper'),
      { force: true }
    ),
  ]);
  const [appleCalendarNative, appleSpeechHelper] = await Promise.all([
    buildAppleCalendarNative(),
    buildAppleSpeechHelper(),
  ]);
  if (!appleCalendarNative.built) {
    console.log(appleCalendarNative.reason);
  }
  if (!appleSpeechHelper.built) {
    console.log(appleSpeechHelper.reason);
  }
}

async function buildMain() {
  const common = config();
  const define: Record<string, string> = {
    ...common.define,
    'process.env.NODE_ENV': `"${mode}"`,
    'process.env.BUILD_TYPE': `"${process.env.BUILD_TYPE || 'stable'}"`,
  };

  if (process.env.BUILD_TYPE_OVERRIDE) {
    define['process.env.BUILD_TYPE_OVERRIDE'] =
      `"${process.env.BUILD_TYPE_OVERRIDE}"`;
  }

  const metafile = process.env.METAFILE;

  const result = await esbuild.build({
    ...common,
    define: define,
    metafile: !!metafile,
  });

  if (metafile) {
    await fs.writeFile(
      path.resolve(rootDir, `metafile-${Date.now()}.json`),
      JSON.stringify(result.metafile, null, 2)
    );
  }
}

// The native helpers (cmake/swift, minutes on a cold CI runner) and the two
// esbuild bundles (seconds) do not depend on each other, so run them
// concurrently and fail the build if any of them fails.
async function buildLayers() {
  await Promise.all([
    buildNativeHelpers(),
    buildLocalAsr(),
    buildAiBackend(),
    buildMain(),
  ]);
}

await buildLayers();
console.log('Build layers done');
