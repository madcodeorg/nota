import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { arch as makeArch } from './make-env.js';

const run = promisify(execFile);
const electronDir = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = path.join(electronDir, 'native/local-asr-helper');
const targetArch = process.env.NOTA_ELECTRON_TARGET_ARCH ?? makeArch;
const targetPlatform = process.platform;
const buildDir = path.join(
  sourceDir,
  '.build',
  `${targetPlatform}-${targetArch}`
);
const resourceDir = path.join(electronDir, 'resources/native');
const whisperCommit = '60c0be6ac8fa71b1a2ae2dd938a31a34a508e774';
// llama.cpp serves chat and meeting summaries on the GPU (Metal on macOS,
// Vulkan on Windows) from a separate helper process.
const llamaCommit = 'd81235049384534c167caea52b85a694f6103d14';
const whisperModelLicenseRevision = '31243bad24cc746f07d4c8bfdd2d974872cb1803';
async function fetchFile(url: string, output: string, sha256?: string) {
  if (sha256) {
    try {
      if (
        createHash('sha256')
          .update(await fs.readFile(output))
          .digest('hex') === sha256
      )
        return;
    } catch {
      /* Download an absent or incomplete build dependency. */
    }
  }
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`ASR build download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256 && createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error('ASR runtime checksum mismatch.');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, bytes);
}
async function cloneAt(url: string, source: string, commit: string) {
  try {
    await fs.access(path.join(source, 'CMakeLists.txt'));
  } catch {
    await run(
      'git',
      ['clone', '--no-checkout', '--filter=blob:none', url, source],
      {
        maxBuffer: 16 * 1024 * 1024,
      }
    );
  }
  await run('git', ['-C', source, 'checkout', '--detach', commit]);
}

async function buildLlamaServer(cmake: string) {
  const source = path.join(buildDir, 'llama.cpp');
  const build = path.join(buildDir, 'llama-cmake');
  await cloneAt(
    'https://github.com/ggml-org/llama.cpp.git',
    source,
    llamaCommit
  );
  const args = [
    '-S',
    source,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_NATIVE=OFF',
    '-DLLAMA_OPENSSL=OFF',
    '-DLLAMA_BUILD_TESTS=OFF',
    '-DLLAMA_BUILD_EXAMPLES=OFF',
    '-DLLAMA_BUILD_APP=OFF',
    '-DLLAMA_BUILD_UI=OFF',
    '-DLLAMA_USE_PREBUILT_UI=OFF',
    '-DLLAMA_BUILD_TOOLS=ON',
    '-DLLAMA_BUILD_SERVER=ON',
  ];
  if (targetPlatform === 'darwin') {
    args.push(
      '-DGGML_METAL=ON',
      '-DGGML_METAL_EMBED_LIBRARY=ON',
      `-DCMAKE_OSX_ARCHITECTURES=${targetArch === 'x64' ? 'x86_64' : 'arm64'}`
    );
  }
  const vulkan =
    process.env.NOTA_LLAMA_VULKAN ?? (targetPlatform === 'win32' ? '1' : '0');
  if (vulkan === '1') args.push('-DGGML_VULKAN=ON');
  await run(cmake, args, { maxBuffer: 16 * 1024 * 1024 });
  await run(
    cmake,
    [
      '--build',
      build,
      '--config',
      'Release',
      '--target',
      'llama-server',
      '-j',
      '4',
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const suffix = targetPlatform === 'win32' ? '.exe' : '';
  let built: string | undefined;
  for (const candidate of [
    path.join(build, 'bin', 'llama-server' + suffix),
    path.join(build, 'bin/Release', 'llama-server' + suffix),
  ]) {
    try {
      await fs.access(candidate);
      built = candidate;
      break;
    } catch {}
  }
  if (!built) throw new Error('Missing compiled llama-server.');
  const output = path.join(resourceDir, 'nota-llama-server' + suffix);
  await fs.copyFile(built, output);
  await fs.chmod(output, 0o755);
  return source;
}

export async function buildLocalAsr() {
  // The shared before-make job runs on Linux only to generate assets; each
  // platform job builds its own native helper.
  if (process.env.NOTA_SKIP_LOCAL_ASR === '1') return;
  await fs.mkdir(buildDir, { recursive: true });
  await fs.mkdir(resourceDir, { recursive: true });
  const whisperSource = path.join(buildDir, 'whisper.cpp');
  try {
    await fs.access(path.join(whisperSource, 'CMakeLists.txt'));
  } catch {
    await run(
      'git',
      [
        'clone',
        '--no-checkout',
        '--filter=blob:none',
        'https://github.com/ggml-org/whisper.cpp.git',
        whisperSource,
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
  }
  await run('git', [
    '-C',
    whisperSource,
    'checkout',
    '--detach',
    whisperCommit,
  ]);
  const cmakeArgs = [
    '-S',
    sourceDir,
    '-B',
    path.join(buildDir, 'cmake'),
    '-DCMAKE_BUILD_TYPE=Release',
    `-DWHISPER_SOURCE=${whisperSource}`,
  ];
  // Windows builds ship the Vulkan GPU backend (CPU fallback stays in the
  // binary); macOS uses Metal via CMakeLists. Linux opts in explicitly.
  const vulkan =
    process.env.NOTA_WHISPER_VULKAN ?? (targetPlatform === 'win32' ? '1' : '0');
  if (vulkan === '1') cmakeArgs.push('-DNOTA_WHISPER_VULKAN=ON');
  if (targetPlatform === 'darwin')
    cmakeArgs.push(
      `-DCMAKE_OSX_ARCHITECTURES=${targetArch === 'x64' ? 'x86_64' : 'arm64'}`
    );
  const cmake = process.env.NOTA_CMAKE_PATH ?? 'cmake';
  await run(cmake, cmakeArgs, { maxBuffer: 16 * 1024 * 1024 });
  await run(
    cmake,
    ['--build', path.join(buildDir, 'cmake'), '--config', 'Release', '-j', '4'],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  for (const name of ['nota-whisper-helper']) {
    const binary = name + (targetPlatform === 'win32' ? '.exe' : '');
    const candidates = [
      path.join(buildDir, 'cmake/bin', binary),
      path.join(buildDir, 'cmake/bin/Release', binary),
    ];
    let built: string | undefined;
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        built = candidate;
        break;
      } catch {}
    }
    if (!built) throw new Error(`Missing compiled ${binary}.`);
    await fs.copyFile(built, path.join(resourceDir, binary));
    await fs.chmod(path.join(resourceDir, binary), 0o755);
  }
  const llamaSource = await buildLlamaServer(cmake);
  const licenseDir = path.join(resourceDir, 'licenses');
  await fs.mkdir(licenseDir, { recursive: true });
  await fs.copyFile(
    path.join(llamaSource, 'LICENSE'),
    path.join(licenseDir, 'llama.cpp-LICENSE')
  );
  await fs.copyFile(
    path.join(whisperSource, 'LICENSE'),
    path.join(licenseDir, 'whisper.cpp-LICENSE')
  );
  await fetchFile(
    `https://raw.githubusercontent.com/openai/whisper/${whisperModelLicenseRevision}/LICENSE`,
    path.join(licenseDir, 'Whisper-model-LICENSE'),
    'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d'
  );
  await fs.writeFile(
    path.join(licenseDir, 'local-asr-NOTICE.txt'),
    `Whisper.cpp: ggml-org, MIT license (${whisperCommit}).\nWhisper model: OpenAI, MIT license; weights from https://huggingface.co/ggerganov/whisper.cpp (5359861c739e955e79d9a303bcbc70fb988958b1).\nllama.cpp: ggml-org, MIT license (${llamaCommit}). Runs chat models (Qwen, Gemma) from GGUF files on the GPU.\n`
  );
  console.log(
    `Local ASR and llama.cpp helpers built for ${targetPlatform}/${targetArch}.`
  );
}
if (import.meta.url === `file://${process.argv[1]}`) await buildLocalAsr();
