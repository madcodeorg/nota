import { createHash } from 'node:crypto';
import type * as Fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ModelRegistry from '../../../../../backend/ai/src/model-registry';

const seeds = ['cactus-whistle', 'whisper-tiny-q5-cpp'];
const repoRoot = fileURLToPath(new URL('../../../../../..', import.meta.url));
const electronRoot = path.join(repoRoot, 'packages/frontend/apps/electron');

it('prefers the canonical rebuilt native addon over legacy staging aliases', () => {
  const source = readFileSync(
    path.join(electronRoot, 'forge.config.mjs'),
    'utf8'
  );
  const match = source.match(/const binaryCandidates = (\[[\s\S]*?\]);/);
  expect(match).not.toBeNull();
  const candidates = runInNewContext(match![1], {
    path,
    nativePackageSourceDir: '/native',
    electronDistDir: '/dist',
    notaBinaryName: 'nota.darwin-arm64.node',
    affineBinaryName: 'affine.darwin-arm64.node',
  });
  expect(Array.from(candidates)).toEqual([
    '/native/nota.darwin-arm64.node',
    '/dist/nota.darwin-arm64.node',
    '/native/affine.darwin-arm64.node',
    '/dist/affine.darwin-arm64.node',
  ]);
});

// Use the YAML parser already shipped by the updater, without a new dependency.
const electronRequire = createRequire(path.join(electronRoot, 'package.json'));
const updaterRequire = createRequire(
  electronRequire.resolve('electron-updater/package.json')
);
const yaml = updaterRequire('js-yaml') as { load: (source: string) => unknown };
const originalArgv = process.argv;
const fixture = vi.hoisted(() => ({
  root: '/nota-release-fixture',
  files: new Map<string, string>(),
  modelRoots: new Set<string>(),
  missingFiles: new Set<string>(),
}));

vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof Fs>()),
  existsSync: (filePath: string) =>
    !fixture.missingFiles.has(filePath) &&
    (filePath.includes(`${path.sep}local-models${path.sep}`)
      ? fixture.files.has(filePath) || fixture.modelRoots.has(filePath)
      : filePath.includes(`${path.sep}sherpa-onnx-darwin-arm64${path.sep}`)
        ? [
            'sherpa-onnx.node',
            'libonnxruntime.dylib',
            'libsherpa-onnx-c-api.dylib',
            'libsherpa-onnx-cxx-api.dylib',
          ].includes(path.basename(filePath))
        : true),
  statSync: (filePath: string) => ({
    isFile: () => true,
    size: fixture.files.get(filePath)?.length ?? 1,
    mode: 0o755,
  }),
  createReadStream: async function* (filePath: string) {
    yield Buffer.from(fixture.files.get(filePath) ?? '');
  },
}));
vi.mock('node:child_process', () => ({
  execFileSync: () => '{"NSAllowsLocalNetworking":true}',
}));
vi.mock('@electron/asar', () => ({
  default: {
    listPackage: () => ['/dist/ai-server.js'],
    statFile: () => ({ size: 1 }),
  },
}));
vi.mock('../../scripts/make-env', () => ({
  buildType: 'canary',
  productName: 'Nota-canary',
}));
vi.mock('../../../../../backend/ai/src/meeting-vad', () => ({
  MEETING_VAD_SHA256: createHash('sha256').update('fixture-vad').digest('hex'),
}));
vi.mock(
  '../../../../../backend/ai/src/model-registry',
  async importOriginal => {
    const actual = await importOriginal<typeof ModelRegistry>();
    return {
      ...actual,
      localModelById: (id: string) => {
        const model = actual.localModelById(id);
        return (
          model && {
            ...model,
            fileSha256: Object.fromEntries(
              actual
                .requiredFilesFor(id)
                .map(file => [
                  file,
                  createHash('sha256').update(`${id}/${file}`).digest('hex'),
                ])
            ),
          }
        );
      },
    };
  }
);

const registry = await vi.importActual<typeof ModelRegistry>(
  '../../../../../backend/ai/src/model-registry'
);

interface Step {
  if?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string | number | boolean>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  with?: Record<string, string>;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  strategy?: { matrix: { spec: { platform: string; arch: string }[] } };
  steps?: Step[];
}
function workflow(file: string): { jobs: Record<string, Job> } {
  return yaml.load(
    readFileSync(path.join(repoRoot, '.github/workflows', file), 'utf8')
  ) as { jobs: Record<string, Job> };
}
const release = workflow('release-desktop.yml');
const platform = workflow('release-desktop-platform.yml');

function bundledModels(env: Record<string, string>) {
  const source = ts.createSourceFile(
    'forge.config.mjs',
    readFileSync(path.join(electronRoot, 'forge.config.mjs'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  // Evaluate only the seed selector, without running Forge's packaging hooks.
  const declarations = source.statements.filter(
    statement =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        declaration =>
          ts.isIdentifier(declaration.name) &&
          ['DEFAULT_SEEDED_LOCAL_MODELS', 'seededLocalModelIds'].includes(
            declaration.name.text
          )
      )
  );
  expect(declarations).toHaveLength(2);
  return runInNewContext(
    `${declarations.map(statement => statement.getText(source)).join('\n')}\nseededLocalModelIds`,
    { process: { env } }
  ) as string[];
}

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('desktop STT release packaging', () => {
  it('uses both ready, checksummed manifests and preserves explicit overrides', () => {
    expect(
      platform.jobs.build.env?.NOTA_BUNDLE_LOCAL_MODELS.split(',')
    ).toEqual(seeds);
    expect(bundledModels({ NOTA_BUNDLE_DEFAULT_STT_MODEL: '1' })).toEqual(
      seeds
    );
    expect(bundledModels({})).toEqual([]);
    expect(
      bundledModels({
        NOTA_BUNDLE_DEFAULT_STT_MODEL: '1',
        NOTA_BUNDLE_LOCAL_MODELS: ` ${seeds[1]}, `,
      })
    ).toEqual([seeds[1]]);
    for (const id of seeds) {
      expect(registry.localModelById(id)).toMatchObject({
        type: 'stt',
        runtime: id === 'cactus-whistle' ? 'cactus-needle' : 'whisper.cpp',
        releaseState: 'ready',
      });
      const files = registry.requiredFilesFor(id);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(registry.localModelById(id)?.fileSha256?.[file]).toMatch(
          /^[a-f0-9]{64}$/
        );
      }
    }
  });

  it('pairs separate seed artifacts, caches, and verification before building', () => {
    const prepareSteps = release.jobs['before-make'].steps!;
    const buildSteps = platform.jobs.build.steps!;
    const artifactNames = new Set<string | number | boolean>();
    const cacheKeys = new Set<string | number | boolean>();
    for (const id of seeds) {
      const modelPath = `.nota/models/${id}`;
      const uploads = prepareSteps.filter(
        step =>
          step.uses?.startsWith('actions/upload-artifact@') &&
          step.with?.path === modelPath
      );
      expect(uploads).toHaveLength(1);
      const upload = uploads[0];
      expect(upload.with).toMatchObject({
        'if-no-files-found': 'error',
        'include-hidden-files': true,
      });
      artifactNames.add(upload.with!.name);
      const downloads = buildSteps.filter(
        step =>
          step.uses?.startsWith('actions/download-artifact@') &&
          step.with?.name === upload.with!.name
      );
      expect(downloads).toHaveLength(1);
      expect(downloads[0].with?.path).toBe(modelPath);
      const cache = prepareSteps.find(
        step =>
          step.uses?.startsWith('actions/cache@') &&
          step.with?.path === modelPath
      );
      expect(cache?.with?.key).toContain(
        "${{ hashFiles('packages/backend/ai/src/model-registry.ts') }}"
      );
      cacheKeys.add(cache!.with!.key);
      const prepare = prepareSteps.findIndex(step =>
        step.run?.includes(`prepare-model-seed --model ${id};`)
      );
      expect(prepare).toBeGreaterThan(prepareSteps.indexOf(cache!));
      expect(prepare).toBeLessThan(prepareSteps.indexOf(upload));
      const verify = buildSteps.findIndex(
        step =>
          step.run ===
          `yarn workspace @nota/ai-backend prepare-model-seed --verify-only --model ${id}`
      );
      expect(verify).toBeGreaterThan(buildSteps.indexOf(downloads[0]));
      expect(verify).toBeLessThan(
        buildSteps.findIndex(step => step.name === 'Build Desktop Layers')
      );
    }
    expect(artifactNames.size).toBe(2);
    expect(cacheKeys.size).toBe(2);
  });

  it('keeps the Windows x64 release chain complete and Intel Mac disabled', () => {
    const jobs = release.jobs;
    for (const job of Object.values(jobs)) {
      for (const dependency of [job.needs ?? []].flat()) {
        expect(jobs).toHaveProperty(dependency);
      }
    }
    expect(
      Object.keys(jobs)
        .filter(name => name.includes('windows'))
        .sort()
    ).toEqual(
      [
        'package-distribution-windows-x64',
        'sign-packaged-artifacts-windows_x64',
        'make-windows-installer',
        'sign-installer-artifacts-windows-x64',
        'finalize-installer-windows',
      ].sort()
    );
    expect(jobs['package-distribution-windows-x64']).toMatchObject({
      needs: 'before-make',
      with: {
        platform: 'win32',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
      },
    });
    expect(jobs['sign-packaged-artifacts-windows_x64']).toMatchObject({
      needs: 'package-distribution-windows-x64',
      with: { 'artifact-name': 'packaged-win32-x64' },
    });
    expect(jobs['make-windows-installer'].needs).toEqual([
      'sign-packaged-artifacts-windows_x64',
    ]);
    expect(Object.keys(jobs['make-windows-installer'].outputs!)).toEqual([
      'FILES_TO_BE_SIGNED_x64',
    ]);
    expect(jobs['sign-installer-artifacts-windows-x64']).toMatchObject({
      needs: 'make-windows-installer',
      with: {
        files:
          '${{ needs.make-windows-installer.outputs.FILES_TO_BE_SIGNED_x64 }}',
        'artifact-name': 'installer-win32-x64',
      },
    });
    expect(jobs['finalize-installer-windows'].needs).toEqual([
      'sign-installer-artifacts-windows-x64',
      'before-make',
    ]);
    for (const name of [
      'make-windows-installer',
      'finalize-installer-windows',
    ]) {
      expect(jobs[name].strategy?.matrix.spec).toEqual([
        expect.objectContaining({ platform: 'win32', arch: 'x64' }),
      ]);
    }
    expect(jobs['make-distribution-macos'].strategy?.matrix.spec).toEqual([
      expect.objectContaining({ platform: 'darwin', arch: 'arm64' }),
    ]);
    expect(jobs.release.needs).toContain('finalize-installer-windows');
    expect(
      jobs.release.steps
        ?.filter(step => step.uses?.startsWith('actions/download-artifact@'))
        .map(step => step.with?.name)
    ).toEqual([
      'nota-darwin-arm64-builds',
      'nota-win32-x64-builds',
      'nota-linux-x64-builds',
    ]);
  });

  it.each([true, false])(
    'merges only produced artifacts into updater manifests (Windows-only: %s)',
    windowsOnly => {
      const releaseSteps = release.jobs.release.steps!;
      const downloads = releaseSteps.filter(step =>
        step.uses?.startsWith('actions/download-artifact@')
      );
      const publishedFiles: string[] = [];
      const targets = [
        {
          platform: 'win32',
          arch: 'x64',
          input: 'desktop_windows',
          steps: release.jobs['finalize-installer-windows'].steps!,
        },
        ...(!windowsOnly
          ? [
              { platform: 'darwin', arch: 'arm64', input: 'desktop_macos' },
              { platform: 'linux', arch: 'x64', input: 'desktop_linux' },
            ].map(target => ({ ...target, steps: platform.jobs.build.steps! }))
          : []),
      ];
      for (const target of targets) {
        const expand = (value: string) =>
          value
            .replaceAll('${{ env.RELEASE_VERSION }}', '0.26.3')
            .replaceAll('${{ env.BUILD_TYPE }}', 'stable')
            .replaceAll('${{ matrix.spec.platform }}', target.platform)
            .replaceAll('${{ inputs.platform }}', target.platform)
            .replaceAll('${{ matrix.spec.arch }}', target.arch)
            .replaceAll('${{ inputs.arch }}', target.arch);
        const upload = target.steps.find(
          step =>
            step.uses?.startsWith('actions/upload-artifact@') &&
            step.with?.path === 'builds'
        )!;
        const download = downloads.find(
          step => step.with?.name === expand(String(upload.with?.name))
        );
        expect(download).toMatchObject({
          if: `\${{ inputs.${target.input} }}`,
          with: { path: './release' },
        });
        const attestation = target.steps.find(
          step =>
            step.uses?.startsWith('actions/attest-build-provenance@') &&
            (!step.if ||
              step.if === `\${{ inputs.platform == '${target.platform}' }}`)
        )!;
        publishedFiles.push(
          ...String(attestation.with?.['subject-path'])
            .trim()
            .split('\n')
            .map(file => path.basename(expand(file)))
        );
      }
      const generateIndex = releaseSteps.findIndex(step =>
        step.run?.includes('node ./scripts/generate-release-yml.mjs')
      );
      expect(generateIndex).toBeGreaterThan(
        Math.max(...downloads.map(step => releaseSteps.indexOf(step)))
      );
      const publishIndex = releaseSteps.findIndex(step =>
        step.uses?.startsWith('softprops/action-gh-release@')
      );
      expect(publishIndex).toBeGreaterThan(generateIndex);
      expect(releaseSteps[publishIndex].with?.files).toBe('./release/*');

      const source = ts.createSourceFile(
        'generate-release-yml.mjs',
        readFileSync(
          path.join(repoRoot, 'scripts/generate-release-yml.mjs'),
          'utf8'
        ),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      );
      const output = new Map<string, string>();
      // Run the actual generator against the merged artifact list, entirely in memory.
      runInNewContext(
        source.statements
          .filter(statement => !ts.isImportDeclaration(statement))
          .map(statement => statement.getText(source))
          .join('\n'),
        {
          crypto: { createHash },
          path,
          console: { info: () => {} },
          process: { cwd: () => repoRoot, env: { RELEASE_VERSION: '0.26.3' } },
          fs: {
            readdirSync: () => [...publishedFiles, 'docker-compose.yml'],
            readFileSync: (file: string) => Buffer.from(path.basename(file)),
            statSync: (file: string) => ({
              size: Buffer.byteLength(path.basename(file)),
            }),
            writeFileSync: (file: string, text: string) =>
              output.set(path.basename(file), text),
          },
        }
      );
      expect([...output.keys()].sort()).toEqual([
        'latest-linux.yml',
        'latest-mac.yml',
        'latest.yml',
      ]);
      for (const [name, text] of output) {
        const manifest = yaml.load(text) as {
          version: string;
          files: { url: string; size: number; sha512: string }[] | null;
        };
        expect(manifest.version).toBe('0.26.3');
        const files = manifest.files ?? [];
        const expected = publishedFiles.filter(
          file =>
            name === 'latest.yml' ||
            file.includes(name === 'latest-mac.yml' ? '-macos-' : '-linux-')
        );
        expect(files.map(file => file.url).sort()).toEqual(expected.sort());
        for (const file of files) {
          expect(file.url).not.toContain('-windows-arm64.');
          expect(file.size).toBe(Buffer.byteLength(file.url));
          expect(file.sha512).toBe(
            createHash('sha512').update(file.url).digest('base64')
          );
        }
      }
      expect(
        publishedFiles.filter(file => file.includes('-windows-')).sort()
      ).toEqual([
        'nota-0.26.3-stable-windows-x64.exe',
        'nota-0.26.3-stable-windows-x64.nsis.exe',
        'nota-0.26.3-stable-windows-x64.zip',
      ]);
    }
  );
});

describe('macOS release-critical seed validation', () => {
  async function check(mutate?: () => void, critical = true) {
    fixture.files.clear();
    fixture.modelRoots.clear();
    fixture.missingFiles.clear();
    for (const id of seeds) {
      const root = path.join(fixture.root, 'local-models', id);
      fixture.modelRoots.add(root);
      for (const file of registry.requiredFilesFor(id)) {
        fixture.files.set(path.join(root, file), `${id}/${file}`);
      }
      fixture.files.set(path.join(root, 'silero_vad.onnx'), 'fixture-vad');
    }
    mutate?.();
    vi.stubEnv('NOTA_MACOS_OUTPUT_ROOT', fixture.root);
    process.argv = critical
      ? ['node', 'check', '--release-critical']
      : ['node', 'check'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    // Native/ASAR checks are stubbed; execute the real seeded-file checker.
    await import('../../scripts/macos-arm64-output-check');
  }

  it('accepts both complete seeds', async () => {
    await expect(check()).resolves.toBeUndefined();
  });

  it.each(['nota-whistle-helper', 'nota-whisper-helper'])(
    'rejects a release without its native speech helper: %s',
    async helper => {
      await expect(
        check(() =>
          fixture.missingFiles.add(path.join(fixture.root, 'native', helper))
        )
      ).rejects.toThrow(`${helper} is missing`);
    }
  );

  it.each([
    'whisper.cpp-LICENSE',
    'Cactus-Needle-LICENSE',
    'Whistle-model-LICENSE',
    'Whisper-model-LICENSE',
    'local-asr-NOTICE.txt',
  ])(
    'rejects a release without the required speech notice: %s',
    async notice => {
      await expect(
        check(() =>
          fixture.missingFiles.add(
            path.join(fixture.root, 'native', 'licenses', notice)
          )
        )
      ).rejects.toThrow(`${notice} is missing`);
    }
  );

  it('rejects a release without the application license', async () => {
    await expect(
      check(() => fixture.missingFiles.add(path.join(fixture.root, 'LICENSE')))
    ).rejects.toThrow('Nota license is missing');
  });

  it.each([
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'licenses/runtime/onnxruntime-LICENSE.txt',
    'licenses/runtime/onnxruntime-ThirdPartyNotices.txt',
    'licenses/runtime/sherpa-onnx-LICENSE.txt',
    'licenses/runtime/transformers-LICENSE.txt',
    'licenses/fonts/OFL.txt',
    'licenses/models/Apache-2.0.txt',
    'licenses/models/Whisper-LICENSE.txt',
  ])('rejects a release without its required attribution: %s', async file => {
    await expect(
      check(() => fixture.missingFiles.add(path.join(fixture.root, file)))
    ).rejects.toThrow('is missing');
  });

  it('requires the ONNX library shipped with sherpa 1.13.8', async () => {
    await expect(
      check(() =>
        fixture.missingFiles.add(
          path.join(
            fixture.root,
            'app.asar.unpacked/node_modules/sherpa-onnx-darwin-arm64/libonnxruntime.dylib'
          )
        )
      )
    ).rejects.toThrow('sherpa-onnx runtime libonnxruntime.dylib is missing');
  });

  it.each(seeds)('rejects a missing release seed: %s', async id => {
    await expect(
      check(() =>
        fixture.modelRoots.delete(path.join(fixture.root, 'local-models', id))
      )
    ).rejects.toThrow('Bundled STT model is missing from release package');
  });

  it.each(seeds)('rejects a missing speech detector in %s', async id => {
    await expect(
      check(() =>
        fixture.files.delete(
          path.join(fixture.root, 'local-models', id, 'silero_vad.onnx')
        )
      )
    ).rejects.toThrow('Bundled speech detector is missing');
  });

  it.each(seeds)('rejects a corrupt speech detector in %s', async id => {
    await expect(
      check(() =>
        fixture.files.set(
          path.join(fixture.root, 'local-models', id, 'silero_vad.onnx'),
          'corrupt'
        )
      )
    ).rejects.toThrow('Bundled speech detector checksum failed');
  });

  it.each(
    seeds.flatMap(id =>
      registry.requiredFilesFor(id).map(file => ({ id, file }))
    )
  )('rejects corrupt $id/$file', async ({ id, file }) => {
    await expect(
      check(() =>
        fixture.files.set(
          path.join(fixture.root, 'local-models', id, file),
          'corrupt'
        )
      )
    ).rejects.toThrow('Bundled STT model checksum failed');
  });

  it.each(seeds)('rejects an incomplete release seed: %s', async id => {
    await expect(
      check(() =>
        fixture.files.delete(
          path.join(
            fixture.root,
            'local-models',
            id,
            registry.requiredFilesFor(id)[0]
          )
        )
      )
    ).rejects.toThrow('is missing');
  });

  it('allows unseeded non-release builds', async () => {
    await expect(
      check(() => fixture.modelRoots.clear(), false)
    ).resolves.toBeUndefined();
  });
});
