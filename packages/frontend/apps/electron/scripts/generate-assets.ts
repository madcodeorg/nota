import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const repoRootDir = path.join(__dirname, '..', '..', '..', '..', '..');
const electronRootDir = path.join(__dirname, '..');
const publicDistDir = path.join(electronRootDir, 'resources');
const webDir = path.join(
  repoRootDir,
  'packages',
  'frontend',
  'apps',
  'electron-renderer'
);
const notaWebOutDir = path.join(webDir, 'dist');
const publicNotaOutDir = path.join(publicDistDir, `web-static`);
const releaseVersionEnv = process.env.RELEASE_VERSION || '';

function runBuild(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    cwd: repoRootDir,
    shell: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Asset build failed (${result.status ?? result.signal ?? 'unknown'}): ${command} ${args.join(' ')}`
    );
  }
}

console.log('build with following variables', {
  repoRootDir,
  electronRootDir,
  publicDistDir,
  notaSrcDir: webDir,
  notaSrcOutDir: notaWebOutDir,
  publicNotaOutDir,
  releaseVersionEnv,
});

// step 0: check version match
const electronPackageJson = require(`${electronRootDir}/package.json`);
if (releaseVersionEnv && electronPackageJson.version !== releaseVersionEnv) {
  throw new Error(
    `Version mismatch, expected ${releaseVersionEnv} but got ${electronPackageJson.version}`
  );
}
// copy web dist files to electron dist

// step 1: build web dist
if (!process.env.SKIP_WEB_BUILD) {
  runBuild('yarn', ['nota', '@nota/electron-renderer', 'build']);
  runBuild('yarn', ['nota', '@nota/electron', 'build']);

  await fs.move(notaWebOutDir, publicNotaOutDir, { overwrite: true });
}
