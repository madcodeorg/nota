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

async function buildLayers() {
  const common = config();
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
  const appleCalendarNative = await buildAppleCalendarNative();
  if (!appleCalendarNative.built) {
    console.log(appleCalendarNative.reason);
  }
  const appleSpeechHelper = await buildAppleSpeechHelper();
  if (!appleSpeechHelper.built) {
    console.log(appleSpeechHelper.reason);
  }
  await buildLocalAsr();
  await buildAiBackend();

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

await buildLayers();
console.log('Build layers done');
