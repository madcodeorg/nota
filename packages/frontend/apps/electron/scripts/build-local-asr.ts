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
const needleRevision = 'c7c415a3d1b3d929014bc6e866d51ebb971f7089';
const whistleRevision = 'b358ddadd89b7a713b5aa131f23032d3cca1b251';
const whisperModelLicenseRevision = '31243bad24cc746f07d4c8bfdd2d974872cb1803';
const needlePlatforms: Record<string, { folder: string; sha256: string }> = {
  'darwin-arm64': {
    folder: 'macos-arm64',
    sha256: 'a3b9163abe7b4bd52487c4005506cb35c5163bb9b9587af4ae07ed7587de697d',
  },
  'linux-arm64': {
    folder: 'linux-arm64',
    sha256: 'd6e33724cab170f0a25bd943d3a8ed5da925fcb793e9fcb1f201bf2478a50f91',
  },
  'linux-x64': {
    folder: 'linux-x86_64',
    sha256: '5c0ff309dcf9c2238bd07986d9d100069d568596c2378f0bfedc1677cc02f756',
  },
  'win32-arm64': {
    folder: 'windows-arm64',
    sha256: 'e6c479a4094896785a22c2a54e3c8bfd8f60903488651ad6d4b47685512cec61',
  },
  'win32-x64': {
    folder: 'windows-x86_64',
    sha256: 'a2501f416a562bf0c2ad734821dd190571d22ced22c104372b8cd41b40245114',
  },
};
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
export async function buildLocalAsr() {
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
  const needle = needlePlatforms[`${targetPlatform}-${targetArch}`];
  const cmakeArgs = [
    '-S',
    sourceDir,
    '-B',
    path.join(buildDir, 'cmake'),
    '-DCMAKE_BUILD_TYPE=Release',
    `-DWHISPER_SOURCE=${whisperSource}`,
  ];
  if (targetPlatform === 'darwin')
    cmakeArgs.push(
      `-DCMAKE_OSX_ARCHITECTURES=${targetArch === 'x64' ? 'x86_64' : 'arm64'}`
    );
  if (needle) {
    const needleDir = path.join(buildDir, 'needle');
    const base = `https://huggingface.co/Cactus-Compute/needle3/resolve/${needleRevision}/${needle.folder}`;
    await fetchFile(
      `${base}/libneedle.a`,
      path.join(needleDir, 'libneedle.a'),
      needle.sha256
    );
    await fetchFile(`${base}/needle.h`, path.join(needleDir, 'needle.h'));
    cmakeArgs.push(
      `-DNEEDLE_LIBRARY=${path.join(needleDir, 'libneedle.a')}`,
      `-DNEEDLE_INCLUDE=${needleDir}`
    );
  } else cmakeArgs.push('-DNEEDLE_LIBRARY=');
  const cmake = process.env.NOTA_CMAKE_PATH ?? 'cmake';
  await run(cmake, cmakeArgs, { maxBuffer: 16 * 1024 * 1024 });
  await run(
    cmake,
    ['--build', path.join(buildDir, 'cmake'), '--config', 'Release', '-j', '4'],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  for (const name of [
    'nota-whisper-helper',
    ...(needle ? ['nota-whistle-helper'] : []),
  ]) {
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
  const licenseDir = path.join(resourceDir, 'licenses');
  await fs.mkdir(licenseDir, { recursive: true });
  await fs.copyFile(
    path.join(whisperSource, 'LICENSE'),
    path.join(licenseDir, 'whisper.cpp-LICENSE')
  );
  if (needle)
    await fetchFile(
      `https://huggingface.co/Cactus-Compute/needle3/resolve/${needleRevision}/LICENSE`,
      path.join(licenseDir, 'Cactus-Needle-LICENSE'),
      'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'
    );
  await fetchFile(
    `https://huggingface.co/Cactus-Compute/whistle/resolve/${whistleRevision}/LICENSE`,
    path.join(licenseDir, 'Whistle-model-LICENSE'),
    'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'
  );
  await fetchFile(
    `https://raw.githubusercontent.com/openai/whisper/${whisperModelLicenseRevision}/LICENSE`,
    path.join(licenseDir, 'Whisper-model-LICENSE'),
    'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d'
  );
  await fs.writeFile(
    path.join(licenseDir, 'local-asr-NOTICE.txt'),
    `Whisper.cpp: ggml-org, MIT license (${whisperCommit}).\nWhisper model: OpenAI, MIT license; weights from https://huggingface.co/ggerganov/whisper.cpp (5359861c739e955e79d9a303bcbc70fb988958b1).\nCactus Needle and Whistle: Cactus Compute, Apache-2.0.\nNeedle runtime: https://huggingface.co/Cactus-Compute/needle3 (${needleRevision}).\nWhistle model: https://huggingface.co/Cactus-Compute/whistle (${whistleRevision}).\n`
  );
  console.log(`Local ASR helpers built for ${targetPlatform}/${targetArch}.`);
}
if (import.meta.url === `file://${process.argv[1]}`) await buildLocalAsr();
