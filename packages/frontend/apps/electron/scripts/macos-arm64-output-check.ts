import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import asar from '@electron/asar';

import { MEETING_VAD_SHA256 } from '../../../../backend/ai/src/meeting-vad';
import {
  localModelById,
  requiredFilesFor,
} from '../../../../backend/ai/src/model-registry';
import { buildType, productName } from './make-env';

const targetArch = 'arm64';
const seededSttModelIds = ['cactus-whistle', 'whisper-tiny-q5-cpp'];
const releaseCritical = process.argv.includes('--release-critical');
const electronRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const outputRoot = path.resolve(
  process.env.NOTA_MACOS_OUTPUT_ROOT ??
    path.join(
      electronRoot,
      'out',
      buildType,
      `${productName}-darwin-${targetArch}`,
      `${productName}.app`,
      'Contents',
      'Resources'
    )
);
const infoPlistPath = path.join(path.dirname(outputRoot), 'Info.plist');

function requireFile(filePath: string, label: string) {
  assert.ok(existsSync(filePath), `${label} is missing: ${filePath}`);
  const file = statSync(filePath);
  assert.ok(file.isFile(), `${label} is not a regular file: ${filePath}`);
  assert.ok(file.size > 0, `${label} is empty: ${filePath}`);
  return file;
}

function requireExecutable(filePath: string, label: string) {
  const file = requireFile(filePath, label);
  assert.ok(
    (file.mode & 0o111) !== 0,
    `${label} is not executable: ${filePath}`
  );
}

function requireArchitecture(filePath: string, label: string) {
  try {
    execFileSync('lipo', [filePath, '-verify_arch', targetArch], {
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(`${label} does not contain ${targetArch}: ${filePath}`, {
      cause: error,
    });
  }
}

function readPlistJson<T>(filePath: string, key: string): T {
  const output = execFileSync(
    'plutil',
    ['-extract', key, 'json', '-o', '-', filePath],
    { encoding: 'utf8' }
  );
  return JSON.parse(output) as T;
}

async function sha256(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function verifyBundledSttModel(modelRoot: string, modelId: string) {
  const model = localModelById(modelId);
  assert.ok(model, `Unknown bundled STT model: ${modelId}`);

  const requiredFiles = requiredFilesFor(modelId);
  assert.ok(
    requiredFiles.length > 0,
    `Bundled STT model has no completeness manifest: ${modelId}`
  );

  for (const relativePath of requiredFiles) {
    const filePath = path.join(modelRoot, relativePath);
    requireFile(filePath, `Bundled STT model file ${relativePath}`);

    const expectedSha256 = model.fileSha256?.[relativePath];
    assert.ok(
      expectedSha256,
      `Bundled STT model manifest has no checksum for ${relativePath}`
    );
    assert.equal(
      await sha256(filePath),
      expectedSha256,
      `Bundled STT model checksum failed for ${relativePath}`
    );
  }
  const vadPath = path.join(modelRoot, 'silero_vad.onnx');
  requireFile(vadPath, 'Bundled speech detector');
  assert.equal(
    await sha256(vadPath),
    MEETING_VAD_SHA256,
    `Bundled speech detector checksum failed for ${modelId}`
  );
}

const appAsarPath = path.join(outputRoot, 'app.asar');
requireFile(appAsarPath, 'Application ASAR');
requireFile(infoPlistPath, 'Application Info.plist');

const appTransportSecurity = readPlistJson<{
  NSAllowsArbitraryLoads?: boolean;
  NSAllowsLocalNetworking?: boolean;
}>(infoPlistPath, 'NSAppTransportSecurity');
assert.notEqual(
  appTransportSecurity.NSAllowsArbitraryLoads,
  true,
  'Application Info.plist must not disable App Transport Security globally'
);
assert.equal(
  appTransportSecurity.NSAllowsLocalNetworking,
  true,
  'Application Info.plist must allow only the local network services used by Nota'
);

const archiveEntries = asar.listPackage(appAsarPath, { isPack: false });
const forbiddenArchivePrefixes = ['/dist/local-models', '/resources/native'];
const duplicatePayloadEntries = archiveEntries.filter(entry =>
  forbiddenArchivePrefixes.some(
    prefix => entry === prefix || entry.startsWith(`${prefix}/`)
  )
);
assert.deepEqual(
  duplicatePayloadEntries,
  [],
  'Local models or native helpers were duplicated inside app.asar'
);

const aiBackendEntry = asar.statFile(appAsarPath, 'dist/ai-server.js');
assert.ok(
  'size' in aiBackendEntry && aiBackendEntry.size > 0,
  'Packaged AI backend bundle is missing or empty: dist/ai-server.js'
);

const unpackedRoot = `${appAsarPath}.unpacked`;
const transformersPackage = path.join(
  unpackedRoot,
  'node_modules/@huggingface/transformers/package.json'
);
const onnxRuntimeBinding = path.join(
  unpackedRoot,
  'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node'
);
const sherpaRuntimeRoot = path.join(
  unpackedRoot,
  'node_modules/sherpa-onnx-darwin-arm64'
);
const sherpaBinding = path.join(sherpaRuntimeRoot, 'sherpa-onnx.node');
const sherpaLibraries = [
  'libonnxruntime.dylib',
  'libsherpa-onnx-c-api.dylib',
  'libsherpa-onnx-cxx-api.dylib',
].map(fileName => path.join(sherpaRuntimeRoot, fileName));
const notaNativeBinding = path.join(
  unpackedRoot,
  'node_modules/@nota/native/nota.darwin-arm64.node'
);
requireFile(transformersPackage, 'Transformers.js runtime');
requireFile(onnxRuntimeBinding, 'ONNX Runtime binding');
requireArchitecture(onnxRuntimeBinding, 'ONNX Runtime binding');
requireFile(sherpaBinding, 'sherpa-onnx Node binding');
requireArchitecture(sherpaBinding, 'sherpa-onnx Node binding');
for (const sherpaLibrary of sherpaLibraries) {
  const label = `sherpa-onnx runtime ${path.basename(sherpaLibrary)}`;
  requireFile(sherpaLibrary, label);
  requireArchitecture(sherpaLibrary, label);
}
requireFile(notaNativeBinding, 'Nota native binding');
requireArchitecture(notaNativeBinding, 'Nota native binding');

const nativeRoot = path.join(outputRoot, 'native');
const calendarBinding = path.join(
  nativeRoot,
  'nota-calendar-native.darwin-arm64.node'
);
const speechHelper = path.join(nativeRoot, 'nota-apple-speech-helper');
requireExecutable(calendarBinding, 'EventKit binding');
requireArchitecture(calendarBinding, 'EventKit binding');

if (releaseCritical) {
  for (const helper of ['nota-whistle-helper', 'nota-whisper-helper']) {
    const helperPath = path.join(nativeRoot, helper);
    requireExecutable(helperPath, helper);
    requireArchitecture(helperPath, helper);
  }
  for (const notice of [
    'whisper.cpp-LICENSE',
    'Cactus-Needle-LICENSE',
    'Whistle-model-LICENSE',
    'Whisper-model-LICENSE',
    'local-asr-NOTICE.txt',
  ]) {
    requireFile(path.join(nativeRoot, 'licenses', notice), notice);
  }
  requireFile(path.join(outputRoot, 'LICENSE'), 'Nota license');
  requireFile(path.join(outputRoot, 'NOTICE'), 'Nota third-party notices');
  requireFile(
    path.join(outputRoot, 'THIRD_PARTY_NOTICES.md'),
    'Nota third-party inventory'
  );
  for (const notice of [
    'runtime/onnxruntime-LICENSE.txt',
    'runtime/onnxruntime-ThirdPartyNotices.txt',
    'runtime/sherpa-onnx-LICENSE.txt',
    'runtime/transformers-LICENSE.txt',
    'fonts/OFL.txt',
    'models/Apache-2.0.txt',
    'models/Whisper-LICENSE.txt',
  ]) {
    requireFile(path.join(outputRoot, 'licenses', notice), notice);
  }
}

if (existsSync(speechHelper)) {
  requireExecutable(speechHelper, 'Apple Speech helper');
  requireArchitecture(speechHelper, 'Apple Speech helper');
} else {
  assert.ok(
    !releaseCritical,
    `Apple Speech helper is missing from release package: ${speechHelper}`
  );
}

for (const modelId of seededSttModelIds) {
  const bundledSttRoot = path.join(outputRoot, 'local-models', modelId);
  if (existsSync(bundledSttRoot)) {
    await verifyBundledSttModel(bundledSttRoot, modelId);
  } else {
    assert.ok(
      !releaseCritical,
      `Bundled STT model is missing from release package: ${bundledSttRoot}`
    );
  }
}

console.log(
  `macOS ${targetArch} output check passed (${releaseCritical ? 'release-critical' : 'standard'}): ${outputRoot}`
);
