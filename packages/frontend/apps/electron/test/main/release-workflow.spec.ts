import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../../..', import.meta.url));
const electronRequire = createRequire(
  path.join(repoRoot, 'packages/frontend/apps/electron/package.json')
);
const updaterRequire = createRequire(
  electronRequire.resolve('electron-updater/package.json')
);
const yaml = updaterRequire('js-yaml') as { load: (source: string) => unknown };

interface Job {
  if?: string;
  needs?: string[];
  uses?: string;
  secrets?: string;
  with?: Record<string, string>;
  steps?: { with?: { script?: string } }[];
}

const workflowDir = path.join(repoRoot, '.github/workflows');
const release = yaml.load(
  readFileSync(path.join(workflowDir, 'release.yml'), 'utf8')
) as {
  on: {
    schedule?: { cron: string }[];
    workflow_dispatch: { inputs: Record<string, unknown> };
  };
  jobs: Record<string, Job>;
};

describe('local-first release workflow', () => {
  it('keeps native builds from overwriting the maintained bridge API', () => {
    const nativeRoot = path.join(repoRoot, 'packages/frontend/native');
    const nativePackage = JSON.parse(
      readFileSync(path.join(nativeRoot, 'package.json'), 'utf8')
    ) as { main: string; types: string; scripts: Record<string, string> };
    for (const script of ['build', 'build:debug']) {
      const args = nativePackage.scripts[script].split(/\s+/);
      expect(args).toContain('--no-js');
      expect(args).toContain('--platform');
      const declarationPath = args[args.indexOf('--dts') + 1];
      expect(declarationPath).toBe('index.generated.d.ts');
      expect(declarationPath).not.toBe(nativePackage.types);
      expect(
        readFileSync(path.join(nativeRoot, '.gitignore'), 'utf8')
      ).toContain(`/${declarationPath}`);
    }
    expect(
      readFileSync(path.join(nativeRoot, nativePackage.main), 'utf8')
    ).toContain('module.exports.AppleSpeechAnalyzer =');
    expect(
      readFileSync(path.join(nativeRoot, nativePackage.types), 'utf8')
    ).toContain('export declare const AppleSpeechAnalyzer:');
    const action = yaml.load(
      readFileSync(
        path.join(repoRoot, '.github/actions/build-rust/action.yml'),
        'utf8'
      )
    ) as { runs: { steps: { name?: string; run?: string }[] } };
    for (const step of action.runs.steps.filter(
      step => step.name === 'Build'
    )) {
      expect(step.run).toContain('yarn workspace ${{ inputs.package }} build');
      expect(step.run).not.toContain('napi build');
    }
  });

  it('loads a clean Apple Silicon build through the maintained wrapper', () => {
    const nativeRoot = path.join(repoRoot, 'packages/frontend/native');
    const nativePackage = JSON.parse(
      readFileSync(path.join(nativeRoot, 'package.json'), 'utf8')
    ) as { main: string; napi: { binaryName: string } };
    const speech = { isAvailable: () => true };
    const binding = { AppleSpeechAnalyzer: speech, ShareableContent: {} };
    const module = { exports: {} as Record<string, unknown> };
    runInNewContext(
      readFileSync(path.join(nativeRoot, nativePackage.main), 'utf8'),
      {
        module,
        process: { platform: 'darwin', arch: 'arm64', env: {} },
        require: (name: string) => {
          if (name === 'node:fs') return { readFileSync: () => '' };
          if (name === `./${nativePackage.napi.binaryName}.darwin-arm64.node`) {
            return binding;
          }
          throw new Error(`Not installed in clean build: ${name}`);
        },
      }
    );
    expect(module.exports.ShareableContent).toBe(binding.ShareableContent);
    expect(module.exports.AppleSpeechAnalyzer).toBe(speech);
  });

  it('versions existing desktop metadata without obsolete Helm deployment paths', () => {
    const script = readFileSync(
      path.join(repoRoot, 'scripts/set-version.sh'),
      'utf8'
    );
    expect(script).not.toMatch(/helm|affine\.metainfo/);
    expect(script).toContain(
      'packages/frontend/apps/electron/resources/nota.metainfo.xml'
    );
    expect(
      existsSync(
        path.join(
          repoRoot,
          'packages/frontend/apps/electron/resources/nota.metainfo.xml'
        )
      )
    ).toBe(true);
  });

  it('keeps only desktop/mobile dispatch inputs and release jobs', () => {
    expect(Object.keys(release.on.workflow_dispatch.inputs).sort()).toEqual([
      'desktop_linux',
      'desktop_macos',
      'desktop_windows',
      'ios-app-version',
      'mobile',
    ]);
    expect(Object.keys(release.jobs).sort()).toEqual([
      'canary-gate',
      'desktop',
      'mobile',
      'prepare',
    ]);
    expect(release.on.schedule).toBeUndefined();
  });

  it('removes cloud-only workflows and assets without dangling workflow calls', () => {
    for (const file of [
      '.github/workflows/release-cloud.yml',
      '.github/workflows/build-images.yml',
      '.github/actions/deploy/action.yml',
      '.github/actions/deploy/deploy.mjs',
      '.github/actions/cluster-auth/action.yml',
      '.github/deployment/node/Dockerfile',
    ]) {
      expect(existsSync(path.join(repoRoot, file)), file).toBe(false);
    }
    for (const file of readdirSync(workflowDir).filter(file =>
      /\.ya?ml$/.test(file)
    )) {
      const workflow = yaml.load(
        readFileSync(path.join(workflowDir, file), 'utf8')
      ) as { jobs: Record<string, Job> };
      for (const job of Object.values(workflow.jobs)) {
        if (job.uses?.startsWith('./')) {
          expect(existsSync(path.join(repoRoot, job.uses)), job.uses).toBe(
            true
          );
        }
      }
    }
  });

  it('preserves desktop gating, platform selection, and mobile version forwarding', () => {
    expect(release.jobs.desktop).toMatchObject({
      needs: ['prepare', 'canary-gate'],
      uses: './.github/workflows/release-desktop.yml',
      secrets: 'inherit',
    });
    expect(release.jobs.desktop.if?.replace(/\s+/g, ' ').trim()).toBe(
      "${{ (github.event_name != 'workflow_dispatch' && needs.canary-gate.outputs.SHOULD_RELEASE == 'true') || inputs.desktop_macos || inputs.desktop_windows || inputs.desktop_linux }}"
    );
    for (const platform of ['macos', 'windows', 'linux']) {
      expect(release.jobs.desktop.with?.[`desktop_${platform}`]).toBe(
        `\${{ github.event_name != 'workflow_dispatch' || inputs.desktop_${platform} }}`
      );
    }
    expect(release.jobs.mobile).toMatchObject({
      if: '${{ inputs.mobile }}',
      needs: ['prepare'],
      uses: './.github/workflows/release-mobile.yml',
      secrets: 'inherit',
      with: { 'ios-app-version': '${{ inputs.ios-app-version }}' },
    });
    for (const job of [release.jobs.desktop, release.jobs.mobile]) {
      expect(job.with).toMatchObject({
        'build-type': '${{ needs.prepare.outputs.BUILD_TYPE }}',
        'app-version': '${{ needs.prepare.outputs.APP_VERSION }}',
        'git-short-hash': '${{ needs.prepare.outputs.GIT_SHORT_HASH }}',
      });
    }
  });

  it.each([
    { buildType: 'stable', lastSha: 'current', expected: 'true' },
    { buildType: 'canary', lastSha: undefined, expected: 'true' },
    { buildType: 'canary', lastSha: 'old', expected: 'true' },
    { buildType: 'canary', lastSha: 'current', expected: 'false' },
  ])(
    'preserves canary decisions: $buildType / $lastSha',
    async ({ buildType, lastSha, expected }) => {
      expect(release.jobs['canary-gate'].needs).toEqual(['prepare']);
      const script = release.jobs['canary-gate'].steps?.[0].with?.script;
      expect(script).toBeDefined();
      const outputs: Record<string, string> = {};
      await runInNewContext(
        `(async () => {${script!.replace('${{ needs.prepare.outputs.BUILD_TYPE }}', buildType)}})()`,
        {
          context: { repo: { owner: 'test', repo: 'nota' }, sha: 'current' },
          core: {
            setOutput: (key: string, value: string) => {
              outputs[key] = value;
            },
            info: () => {},
            warning: () => {},
          },
          github: {
            rest: {
              repos: {
                listTags: async () => ({
                  data: lastSha
                    ? [
                        {
                          name: 'v0.26.4-canary.abcdef',
                          commit: { sha: lastSha },
                        },
                      ]
                    : [],
                }),
              },
            },
          },
        }
      );
      expect(outputs.SHOULD_RELEASE).toBe(expected);
    }
  );
});
