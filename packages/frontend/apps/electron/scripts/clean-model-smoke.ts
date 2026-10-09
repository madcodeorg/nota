/**
 * Packaged-backend integration smoke, without starting Electron or recording.
 * node node_modules/tsx/dist/cli.mjs packages/frontend/apps/electron/scripts/clean-model-smoke.ts /absolute/Nota.app [--download-tiny]
 *
 * Retains evidence and disposable profiles in the printed temporary directory.
 * Electron release fuses disable RunAsNode, so the launcher is host Node;
 * backend code, native inference libraries, and seeds are package-only.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  realpathSync,
} from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import asar from '@electron/asar';

const appPath = process.argv[2];
assert.ok(appPath?.endsWith('.app'), 'Pass an absolute packaged .app path.');
assert.ok(path.isAbsolute(appPath));
assert.equal(
  process.platform,
  'darwin',
  'This harness uses macOS sandbox-exec.'
);
const resources = path.join(realpathSync(appPath), 'Contents', 'Resources');
const downloadTiny = process.argv.includes('--download-tiny');
const base = 'whisper-base-q5-cpp';
const tiny = 'whisper-tiny-q5-cpp';
const root = realpathSync(
  await mkdtemp(path.join(os.tmpdir(), 'nota-clean-model-'))
);
const extracted = path.join(root, 'package');
const seedRoot = path.join(resources, 'local-models');
const backendPath = path.join(extracted, 'dist', 'ai-server.js');
const results: Record<string, unknown> = {
  appPath: realpathSync(appPath),
  startedAt: new Date().toISOString(),
  root,
  launcher: { executable: process.execPath, version: process.version },
  limitation:
    'Host Node launcher, not Electron utilityProcess; no audio/capture/UI test.',
};
const activeStops = new Set<() => Promise<void>>();

async function checkpoint() {
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(results, null, 2)
  );
}

async function hash(file: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function inventory(directory: string, prefix = '') {
  const files: Record<string, { bytes: number; ino: number; mtimeMs: number }> =
    {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    assert.ok(
      !(await lstat(full)).isSymbolicLink(),
      `Unexpected symlink: ${full}`
    );
    if (entry.isDirectory()) {
      Object.assign(files, await inventory(full, relative));
    } else {
      const metadata = await stat(full);
      files[relative] = {
        bytes: metadata.size,
        ino: metadata.ino,
        mtimeMs: metadata.mtimeMs,
      };
    }
  }
  return files;
}

async function startBackend(
  name: string,
  profile: string,
  seeds: boolean,
  online = false
) {
  const home = path.join(profile, 'home');
  const cache = path.join(profile, 'cache');
  const temporary = path.join(profile, 'tmp');
  for (const directory of [home, cache, temporary])
    await mkdir(directory, { recursive: true });
  const token = randomBytes(32).toString('hex');
  // Deliberately do not spread process.env: no provider keys, NODE_PATH,
  // NODE_OPTIONS, DYLD overrides, proxy credentials, or external model paths.
  const env = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    TMPDIR: temporary,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    HF_HOME: path.join(cache, 'huggingface'),
    HUGGINGFACE_HUB_CACHE: path.join(cache, 'huggingface', 'hub'),
    TRANSFORMERS_CACHE: path.join(cache, 'transformers'),
    HF_HUB_OFFLINE: online ? '0' : '1',
    NODE_ENV: 'production',
    NOTA_AI_HOST: '127.0.0.1',
    NOTA_AI_PORT: '0',
    NOTA_AI_BACKEND_TOKEN: token,
    NOTA_AI_WORKSPACE_ROOT: profile,
    NOTA_AI_SETTINGS_PATH: path.join(profile, '.nota', 'ai-settings.json'),
    NOTA_AI_SEEDED_MODEL_ROOT: seeds
      ? seedRoot
      : path.join(profile, 'no-seeds'),
    NOTA_AI_LOCAL_BASE_URL: 'http://127.0.0.1:1/v1',
    NOTA_AI_MCP_ENABLED: 'false',
    NOTA_AI_TOOLS_ENABLED: 'false',
    NOTA_AI_EMBEDDING_ALLOW_REMOTE: 'false',
    NOTA_NATIVE_ASR_DIR: path.join(resources, 'native'),
    DYLD_LIBRARY_PATH: path.join(
      extracted,
      'node_modules',
      'sherpa-onnx-darwin-arm64'
    ),
  };
  const policy = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${JSON.stringify(root)}) (literal "/dev/null"))`,
    online ? '' : '(deny network-outbound)',
  ].join('\n');
  const policyPath = path.join(root, `${name}.sb`);
  await writeFile(policyPath, policy);
  const logPath = path.join(root, `${name}.log`);
  const log = createWriteStream(logPath);
  const started = performance.now();
  const child = spawn(
    '/usr/bin/sandbox-exec',
    ['-f', policyPath, process.execPath, backendPath],
    {
      cwd: profile,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const closed = new Promise<void>(resolve =>
    child.once('close', () => resolve())
  );
  let output = '';
  let spawnError: Error | undefined;
  child.on('error', error => {
    spawnError = error;
  });
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    log.write(chunk);
  });
  child.stderr.on('data', chunk => log.write(chunk));
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await closed;
    clearTimeout(force);
    await new Promise<void>(resolve => log.end(resolve));
    activeStops.delete(stop);
  };
  activeStops.add(stop);
  try {
    let match: RegExpMatchArray | null = null;
    while (
      !(match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/))
    ) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, `Backend exited; inspect ${logPath}`);
      assert.equal(
        child.signalCode,
        null,
        `Backend killed; inspect ${logPath}`
      );
      assert.ok(
        performance.now() - started < 120_000,
        `Startup timed out; inspect ${logPath}`
      );
      await delay(50);
    }
    const baseUrl = match[1];
    const startupMs = Math.round(performance.now() - started);
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(`${baseUrl}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-nota-backend-token': token,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await response.json();
      assert.ok(
        response.ok,
        `${route}: HTTP ${response.status} ${JSON.stringify(data)}`
      );
      return data;
    };
    results[name] = {
      profile,
      startupMs,
      logPath,
      pid: child.pid,
      online,
      seeds,
    };
    console.log(`${name}: ready in ${startupMs} ms; isolated pid=${child.pid}`);
    await checkpoint();
    return { request, stop, logPath, profile };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function modelStatus(
  backend: Awaited<ReturnType<typeof startBackend>>,
  modelId: string
) {
  const health = await backend.request('/v1/local/models');
  assert.equal(
    health.device.modelRoot,
    path.join(backend.profile, '.nota', 'models')
  );
  const model = health.models.find(
    (item: { id: string }) => item.id === modelId
  );
  assert.ok(model, `Missing registry entry ${modelId}`);
  assert.equal(
    model.localPath,
    path.join(backend.profile, '.nota', 'models', modelId)
  );
  return model;
}

async function checkPreload(
  backend: Awaited<ReturnType<typeof startBackend>>,
  providerId: string,
  modelId: string,
  cached: boolean
) {
  const started = performance.now();
  const { preload } = await backend.request('/v1/stt/runtime/preload', {
    providerId,
  });
  assert.equal(preload.available, true, JSON.stringify(preload));
  assert.equal(
    preload.providerId,
    providerId === 'auto' ? 'whisper-base-cpp' : providerId
  );
  assert.equal(preload.modelId, modelId);
  assert.equal(preload.cached, cached);
  assert.equal(preload.status, cached ? 'cached' : 'loaded');
  return { ...preload, wallMs: Math.round(performance.now() - started) };
}

async function verifyModelFiles(
  profile: string,
  model: { id: string; files: string[]; fileSha256: Record<string, string> }
) {
  const evidence: Record<string, unknown> = {};
  for (const file of model.files) {
    const target = path.join(profile, '.nota', 'models', model.id, file);
    assert.ok(model.fileSha256[file], `No packaged checksum for ${file}`);
    const digest = await hash(target);
    assert.equal(digest, model.fileSha256[file], `Checksum failed: ${target}`);
    evidence[file] = { bytes: (await stat(target)).size, sha256: digest };
  }
  return evidence;
}

async function run() {
  console.log(`Evidence root: ${root}`);
  const extractionStarted = performance.now();
  asar.extractAll(path.join(resources, 'app.asar'), extracted);
  results.extractionMs = Math.round(performance.now() - extractionStarted);
  const metadata = JSON.parse(
    await readFile(path.join(extracted, 'package.json'), 'utf8')
  );
  assert.match(metadata.version, /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i);
  results.packageVersion = metadata.version;
  results.backendSha256 = await hash(backendPath);
  results.packagedSherpaVersion = JSON.parse(
    await readFile(
      path.join(extracted, 'node_modules/sherpa-onnx-node/package.json'),
      'utf8'
    )
  ).version;
  assert.equal(
    await hash(backendPath),
    createHash('sha256')
      .update(
        asar.extractFile(path.join(resources, 'app.asar'), 'dist/ai-server.js')
      )
      .digest('hex')
  );
  // Native package paths must stay within the extraction, never repo node_modules.
  for (const relative of [
    'node_modules/sherpa-onnx-node',
    'node_modules/sherpa-onnx-darwin-arm64',
    'node_modules/onnxruntime-node',
  ]) {
    assert.ok(
      realpathSync(path.join(extracted, relative)).startsWith(`${extracted}/`)
    );
  }

  const profile = path.join(root, 'seeded-profile');
  await mkdir(profile);
  assert.deepEqual(await readdir(profile), []);
  const seedsBefore = await inventory(seedRoot);
  results.packagedSeeds = seedsBefore;
  const first = await startBackend('seeded-first', profile, true);
  const modelEvidence: Record<string, unknown> = {};
  for (const modelId of [base, tiny]) {
    const model = await modelStatus(first, modelId);
    assert.equal(model.downloadStatus, 'downloaded', JSON.stringify(model));
    modelEvidence[modelId] = await verifyModelFiles(profile, model);
  }
  results.seededFileChecksums = modelEvidence;
  const runtime = await first.request('/v1/stt/runtime');
  assert.equal(runtime.selectedProviderId, 'auto');
  assert.equal(runtime.resolvedProviderId, 'whisper-base-cpp');
  assert.equal(runtime.transcriptAvailable, true);
  results.seededRuntime = runtime;
  results.seededPreload = await checkPreload(first, 'auto', base, false);
  results.seededCachedPreload = await checkPreload(first, 'auto', base, true);
  assert.equal(
    existsSync(path.join(profile, '.nota', 'ai-settings.json')),
    false
  );
  const installedBeforeRestart = await inventory(
    path.join(profile, '.nota', 'models')
  );
  await first.stop();
  console.log(`PASS seeded install, checksums, native preload, warm reuse`);
  await checkpoint();

  // Remove seed access on restart: reuse must come from this profile's install.
  const restart = await startBackend('seeded-restart', profile, false);
  results.restartPreload = await checkPreload(restart, 'auto', base, false);
  assert.deepEqual(
    await inventory(path.join(profile, '.nota', 'models')),
    installedBeforeRestart
  );
  assert.equal(
    existsSync(path.join(profile, '.nota', 'models', 'downloads.json')),
    false
  );
  await restart.stop();
  console.log(
    'PASS restart native preload, no seeds/network, unchanged model files'
  );
  await checkpoint();

  const emptyProfile = path.join(root, 'unseeded-profile');
  await mkdir(emptyProfile);
  assert.deepEqual(await readdir(emptyProfile), []);
  const empty = await startBackend('unseeded-empty', emptyProfile, false);
  for (const modelId of [base, tiny]) {
    const model = await modelStatus(empty, modelId);
    assert.equal(model.downloadStatus, 'not_started', JSON.stringify(model));
  }
  const emptyRuntime = await empty.request('/v1/stt/runtime');
  assert.equal(emptyRuntime.transcriptAvailable, false);
  results.emptyRuntime = emptyRuntime;
  results.emptyPreloads = {};
  for (const providerId of ['auto', 'whisper-base-cpp']) {
    const { preload } = await empty.request('/v1/stt/runtime/preload', {
      providerId,
    });
    assert.equal(preload.available, false, JSON.stringify(preload));
    assert.ok(['unavailable', 'missing_model'].includes(preload.status));
    assert.match(
      preload.message,
      /download|missing|not.*installed|not.*ready|available/i
    );
    (results.emptyPreloads as Record<string, unknown>)[providerId] = preload;
  }
  assert.equal(
    existsSync(path.join(emptyProfile, '.nota', 'models', base)),
    false
  );
  assert.equal(
    existsSync(path.join(emptyProfile, '.nota', 'ai-settings.json')),
    false
  );
  await empty.stop();
  console.log(
    'PASS empty unseeded profile reports unavailable/missing model honestly'
  );
  await checkpoint();

  if (downloadTiny) {
    const downloaded = await startBackend(
      'tiny-download',
      emptyProfile,
      false,
      true
    );
    const route = `/v1/local/models/${tiny}/download`;
    const dryRun = await downloaded.request(route, { dryRun: true });
    assert.ok(dryRun.download.plan.totalBytes > 0);
    assert.ok(
      dryRun.download.plan.totalBytes <= 110_000_000,
      'Tiny exceeds network budget'
    );
    results.tinyPlan = dryRun.download.plan;
    const started = performance.now();
    await downloaded.request(route, {});
    let state;
    do {
      assert.ok(
        performance.now() - started < 180_000,
        'Tiny download exceeded 3 minutes'
      );
      await delay(500);
      state = await downloaded.request(route);
      assert.notEqual(
        state.download.downloadStatus,
        'error',
        JSON.stringify(state)
      );
    } while (state.download.downloadStatus !== 'downloaded');
    results.tinyDownloadMs = Math.round(performance.now() - started);
    results.tinyDownload = state.download;
    results.tinyChecksums = await verifyModelFiles(emptyProfile, state.model);
    await downloaded.stop();
    const offline = await startBackend(
      'tiny-offline-preload',
      emptyProfile,
      false
    );
    results.tinyPreload = await checkPreload(
      offline,
      'whisper-tiny-cpp',
      tiny,
      false
    );
    await offline.stop();
    console.log('PASS Tiny HTTP download, checksums, offline native preload');
  } else {
    results.tinyDownload = 'Skipped; opt in with --download-tiny.';
  }
  assert.deepEqual(await inventory(seedRoot), seedsBefore);
  results.outcome = 'PASS';
}

try {
  await run();
} catch (error) {
  results.outcome = 'FAIL';
  results.error = error instanceof Error ? error.stack : String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const stop of activeStops) await stop();
  results.finishedAt = new Date().toISOString();
  await checkpoint();
  console.log(`Result: ${results.outcome}; ${path.join(root, 'results.json')}`);
}
