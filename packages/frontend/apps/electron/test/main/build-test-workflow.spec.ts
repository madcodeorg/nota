import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../../..', import.meta.url));
const electronRequire = createRequire(
  path.join(repoRoot, 'packages/frontend/apps/electron/package.json')
);
const updaterRequire = createRequire(
  electronRequire.resolve('electron-updater/package.json')
);
const yaml = updaterRequire('js-yaml') as { load: (source: string) => unknown };
const source = readFileSync(
  path.join(repoRoot, '.github/workflows/build-test.yml'),
  'utf8'
);

interface Job {
  needs?: string | string[];
  if?: string;
  steps: {
    uses?: string;
    run?: string;
    if?: string;
    with?: Record<string, unknown>;
    'working-directory'?: string;
  }[];
}

const { jobs } = yaml.load(source) as { jobs: Record<string, Job> };
const dependencies = (job: Job) =>
  typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
const commands = (id: string) =>
  jobs[id].steps.map(step => step.run ?? '').join('\n');

describe('local-first build and test workflow', () => {
  it('removes deleted server jobs, artifacts, configuration and action', () => {
    for (const id of [
      'build-server-native',
      'server-test',
      'server-test-elasticsearch',
      'server-e2e-test',
      'copilot-test-filter',
      'copilot-api-test',
    ]) {
      expect(jobs).not.toHaveProperty(id);
    }
    expect(source).not.toMatch(
      /@nota\/server\b|packages\/backend\/(?:server|native)\b|server-native\.node|nota_server_native|server genconfig|server-test-env/
    );
    expect(
      existsSync(
        path.join(repoRoot, '.github/actions/server-test-env/action.yml')
      )
    ).toBe(false);
    expect(dependencies(jobs['check-git-status'])).toEqual([]);
    expect(commands('check-git-status')).toContain('yarn nota init');
    expect(commands('check-git-status')).toContain(
      'yarn workspace @nota/graphql check'
    );
    expect(commands('check-git-status')).not.toContain('yarn nota gql build');
    expect(commands('check-git-status')).toContain('yarn nota i18n build');
  });

  it('runs locked oxlint after dependency setup instead of resolving a fresh version', () => {
    const steps = jobs.lint.steps;
    const setup = steps.findIndex(
      step => step.uses === './.github/actions/setup-node'
    );
    const lint = steps.findIndex(step => step.run === 'yarn lint:ox');
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(lint).toBeGreaterThan(setup);
    expect(commands('lint')).not.toMatch(/yarn dlx.*oxlint/);
  });

  it('has an acyclic dependency graph and gates every remaining job', () => {
    function visit(id: string, ancestors: string[] = []) {
      expect(jobs, id).toHaveProperty(id);
      expect(ancestors, id).not.toContain(id);
      for (const dependency of dependencies(jobs[id])) {
        visit(dependency, [...ancestors, id]);
      }
    }
    for (const id of Object.keys(jobs)) visit(id);
    expect(dependencies(jobs['test-done']).sort()).toEqual(
      Object.keys(jobs)
        .filter(id => id !== 'test-done')
        .sort()
    );
    expect(jobs['test-done'].if).toBe('always()');
    expect(jobs['test-done'].steps).toContainEqual({
      run: 'exit 1',
      if: "${{ always() && (contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')) }}",
    });
  });

  it('references existing workspace packages and local actions', () => {
    const root = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ) as {
      workspaces: string[];
    };
    const packages = new Set(
      globSync(
        root.workspaces.map(workspace => `${workspace}/package.json`),
        {
          cwd: repoRoot,
          ignore: ['**/node_modules/**'],
        }
      ).map(
        file =>
          (
            JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
              name: string;
            }
          ).name
      )
    );
    for (const match of source.matchAll(
      /@(?:nota(?:-test|-tools)?|blocksuite)\/[\w-]+/g
    )) {
      expect(packages.has(match[0]), match[0]).toBe(true);
    }
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith('./')) {
          expect(
            existsSync(path.join(repoRoot, step.uses, 'action.yml')),
            step.uses
          ).toBe(true);
        }
      }
    }
  });

  it('preserves lint, typecheck, native, editor, local and backend AI coverage', () => {
    for (const id of [
      'lint',
      'typecheck',
      'lint-rust',
      'unit-test',
      'native-unit-test',
      'build-native-linux',
      'build-native-macos',
      'build-native-windows',
      'build-electron-renderer',
      'desktop-test',
      'e2e-test',
      'e2e-blocksuite-test',
      'rust-test',
      'loom',
    ])
      expect(jobs).toHaveProperty(id);
    expect(commands('unit-test')).toContain('yarn test:coverage');
    expect(commands('e2e-test')).toContain(
      'yarn nota @nota-test/nota-local e2e'
    );
    expect(JSON.stringify(jobs['desktop-test'])).toContain('@nota/ai-backend');
    expect(
      readFileSync(path.join(repoRoot, 'vitest.config.ts'), 'utf8')
    ).toContain('packages/backend/**/*.spec.ts');
    expect(commands('lint-rust')).toContain(
      'cargo clippy --workspace --all-targets --all-features -- -D warnings'
    );
    expect(commands('rust-test')).toContain(
      'cargo nextest run --workspace --features use-as-lib --release --no-fail-fast'
    );
    for (const id of ['loom']) {
      expect(commands(id)).toContain('-p y-octo');
    }
    for (const file of [
      'packages/common/y-octo/core/Cargo.toml',
      'packages/common/y-octo/utils/fuzz/Cargo.toml',
    ])
      expect(existsSync(path.join(repoRoot, file)), file).toBe(true);
  });
});
