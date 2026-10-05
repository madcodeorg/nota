import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type { BuildContext } from 'esbuild';
import * as esbuild from 'esbuild';
import kill from 'tree-kill';

import { aiBackendConfig, config, electronDir, rootDir } from './common';
import {
  parseDevCodeSigningIdentities,
  parseDevSigningIdentity,
  selectDevSigningIdentity,
} from './dev-signing';

// this means we don't spawn electron windows, mainly for testing
const watchMode = process.argv.includes('--watch');

/** Messages on stderr that match any of the contained patterns will be stripped from output */
const stderrFilterPatterns = [
  // warning about devtools extension
  // https://github.com/cawa-93/vite-electron-builder/issues/492
  // https://github.com/MarshallOfSound/electron-devtools-installer/issues/143
  /ExtensionLoadWarning/,
];

function writeElectronStderr(data: Buffer) {
  const message = data.toString().trim();
  if (!message) return;
  const mayIgnore = stderrFilterPatterns.some(pattern => pattern.test(message));
  if (mayIgnore) return;
  console.error(message);
}

let spawnProcess: ChildProcessWithoutNullStreams | null = null;
let logTailProcesses: ChildProcessWithoutNullStreams[] = [];
let restartQueue = Promise.resolve();

const macOSDevAppBundleIdentifier = 'pro.nota.app.dev';
const macOSDevAppDisplayName = 'Nota Dev';
const macOSDevAppCacheDir = resolve(rootDir, 'out', 'nota-dev');
const macOSDevAppBundle = resolve(
  macOSDevAppCacheDir,
  `${macOSDevAppDisplayName}.app`
);
const macOSDevAppBackupBundle = resolve(
  macOSDevAppCacheDir,
  `${macOSDevAppDisplayName}.backup.app`
);
const macOSDevAppFingerprintFile = resolve(macOSDevAppCacheDir, 'source.json');
const macOSDevAppPromotionFile = resolve(macOSDevAppCacheDir, 'promotion.json');
const macOSDevStdoutLog = resolve(macOSDevAppCacheDir, 'stdout.log');
const macOSDevStderrLog = resolve(macOSDevAppCacheDir, 'stderr.log');
const macOSDevBackendTokenFile = resolve(macOSDevAppCacheDir, '.backend-token');

const macOSDevElectronBundleMetadata = {
  CFBundleDisplayName: macOSDevAppDisplayName,
  CFBundleIconFile: 'nota-dev.icns',
  CFBundleIdentifier: macOSDevAppBundleIdentifier,
  CFBundleName: macOSDevAppDisplayName,
};

// `open` receives the complete environment through spawn. Repeat only the
// non-secret runtime switches whose values LaunchServices must preserve
// explicitly; secret-bearing provider values must never appear in argv.
const macOSDevForwardedEnvironmentKeys = [
  'BUILD_TYPE',
  'BUILD_TYPE_OVERRIDE',
  'CI',
  'DEV_SERVER_URL',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'NODE_ENV',
  'NODE_OPTIONS',
  'NOTA_AI_BACKEND_URL',
  'NOTA_AI_BACKEND_TOKEN_FILE',
  'NOTA_AI_PORT',
  'NOTA_AI_SEEDED_MODEL_ROOT',
  'NOTA_AI_WORKSPACE_ROOT',
  'NOTA_APPLE_CALENDAR_NATIVE',
  'NOTA_APPLE_SPEECH_HELPER',
  'NOTA_ENABLE_AUTO_UPDATE',
  'SKIP_ONBOARDING',
] as const;

const devElectronTccUsageDescriptions = {
  NSAudioCaptureUsageDescription:
    'Allow Nota to capture system audio while recording your meetings.',
  NSCalendarsFullAccessUsageDescription:
    'Please allow access so Nota can show local calendar meetings before you start recording.',
  NSCalendarsUsageDescription:
    'Please allow access so Nota can show local calendar meetings before you start recording.',
  NSCalendarsWriteOnlyAccessUsageDescription:
    'Please allow access so Nota can show local calendar meetings before you start recording.',
  NSMicrophoneUsageDescription:
    'Please allow access so Nota can record meeting audio from your microphone.',
};

function devElectronCodeSignatureIsValid(appBundle: string) {
  try {
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', appBundle],
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

function findMacOSDevCodeSigningIdentities() {
  try {
    const identities = execFileSync('/usr/bin/security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ]).toString();
    return parseDevCodeSigningIdentities(identities);
  } catch {
    return [];
  }
}

function readDevElectronCertificateHash(appBundle: string) {
  const directory = mkdtempSync(resolve(tmpdir(), 'nota-dev-certificate-'));
  try {
    const prefix = resolve(directory, 'certificate');
    execFileSync(
      '/usr/bin/codesign',
      ['-d', `--extract-certificates=${prefix}`, appBundle],
      { stdio: 'ignore' }
    );
    return new X509Certificate(
      readFileSync(`${prefix}0`)
    ).fingerprint.replaceAll(':', '');
  } catch (error) {
    throw new Error(
      'Cannot read the cached Nota Dev signing certificate. Restore the cached app ' +
        'or explicitly set NOTA_DEV_CODESIGN_IDENTITY before re-signing.',
      { cause: error }
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function readDevElectronSigningIdentity(appBundle: string) {
  const result = spawnSync('/usr/bin/codesign', ['-dvv', appBundle], {
    encoding: 'utf8',
  });
  return result.status === 0
    ? parseDevSigningIdentity(`${result.stdout ?? ''}${result.stderr ?? ''}`)
    : null;
}

function devElectronUsesSigningIdentity(
  appBundle: string,
  signingIdentity: string
) {
  if (/^[0-9a-f]{40}$/i.test(signingIdentity)) {
    return (
      spawnSync(
        '/usr/bin/codesign',
        [
          '--verify',
          '-R',
          `=certificate leaf = H"${signingIdentity}"`,
          appBundle,
        ],
        { stdio: 'ignore' }
      ).status === 0
    );
  }
  return readDevElectronSigningIdentity(appBundle) === signingIdentity;
}

function devElectronPlistStringMatches(
  infoPlist: string,
  key: string,
  value: string
) {
  let currentValue = '';
  try {
    currentValue = execFileSync(
      '/usr/bin/plutil',
      ['-extract', key, 'raw', '-o', '-', infoPlist],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
      .toString()
      .trim();
  } catch {
    currentValue = '';
  }
  return currentValue === value;
}

function readDevElectronAppCache() {
  const sourceAppBundle = resolve(
    rootDir,
    'node_modules',
    'electron',
    'dist',
    'Electron.app'
  );
  const sourceExecutable = resolve(
    sourceAppBundle,
    'Contents',
    'MacOS',
    'Electron'
  );
  const sourceFingerprint = JSON.stringify(
    [
      sourceExecutable,
      resolve(sourceAppBundle, 'Contents', 'Info.plist'),
      resolve(
        sourceAppBundle,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'Current',
        'Electron Framework'
      ),
    ].map(file => {
      const stat = statSync(file);
      return { modifiedAt: stat.mtimeMs, size: stat.size };
    })
  );
  let cachedFingerprint = '';
  try {
    cachedFingerprint = readFileSync(macOSDevAppFingerprintFile, 'utf8');
  } catch {
    // The cache has not been created yet.
  }

  if (
    existsSync(macOSDevAppBundle) &&
    cachedFingerprint === sourceFingerprint
  ) {
    return {
      appBundle: macOSDevAppBundle,
      sourceFingerprint,
      needsReplacement: false,
    };
  }

  return {
    appBundle: sourceAppBundle,
    sourceFingerprint,
    needsReplacement: true,
  };
}

function stageDevElectronAppBundle(sourceAppBundle: string) {
  mkdirSync(macOSDevAppCacheDir, { recursive: true });
  const stagingAppBundle = resolve(
    macOSDevAppCacheDir,
    `${macOSDevAppDisplayName}.staging.app`
  );
  rmSync(stagingAppBundle, { force: true, recursive: true });
  try {
    // APFS clone-copy keeps this 250+ MB development bundle inexpensive.
    execFileSync('/bin/cp', ['-cR', sourceAppBundle, stagingAppBundle]);
  } catch {
    rmSync(stagingAppBundle, { force: true, recursive: true });
    cpSync(sourceAppBundle, stagingAppBundle, { recursive: true });
  }
  return stagingAppBundle;
}

function recoverDevElectronAppPromotion() {
  if (!existsSync(macOSDevAppPromotionFile)) return;
  const previous: { hadBundle: boolean; fingerprint: string | null } =
    JSON.parse(readFileSync(macOSDevAppPromotionFile, 'utf8'));
  if (
    !previous ||
    typeof previous.hadBundle !== 'boolean' ||
    (previous.fingerprint !== null && typeof previous.fingerprint !== 'string')
  ) {
    throw new Error(
      'Invalid Nota Dev promotion journal; preserve the backup and repair the cache manually.'
    );
  }
  if (previous.hadBundle) {
    if (existsSync(macOSDevAppBackupBundle)) {
      rmSync(macOSDevAppBundle, { force: true, recursive: true });
      renameSync(macOSDevAppBackupBundle, macOSDevAppBundle);
    } else if (!existsSync(macOSDevAppBundle)) {
      throw new Error(
        'Cannot recover Nota Dev: both the cached app and its backup are missing.'
      );
    }
    // No backup means promotion never moved the old app, or rollback already restored it.
  } else {
    rmSync(macOSDevAppBundle, { force: true, recursive: true });
  }
  if (previous.fingerprint === null) {
    rmSync(macOSDevAppFingerprintFile, { force: true });
  } else {
    writeFileSync(`${macOSDevAppFingerprintFile}.tmp`, previous.fingerprint);
    renameSync(`${macOSDevAppFingerprintFile}.tmp`, macOSDevAppFingerprintFile);
  }
  rmSync(macOSDevAppPromotionFile);
}

function promoteDevElectronAppBundle(
  appBundle: string,
  sourceFingerprint: string
) {
  // The journal is published before moving the old app and removed only after
  // both replacements succeed. Recovery can itself be interrupted and retried.
  const previous = {
    hadBundle: existsSync(macOSDevAppBundle),
    fingerprint: existsSync(macOSDevAppFingerprintFile)
      ? readFileSync(macOSDevAppFingerprintFile, 'utf8')
      : null,
  };
  rmSync(macOSDevAppBackupBundle, { force: true, recursive: true });
  writeFileSync(`${macOSDevAppPromotionFile}.tmp`, JSON.stringify(previous));
  renameSync(`${macOSDevAppPromotionFile}.tmp`, macOSDevAppPromotionFile);
  try {
    if (previous.hadBundle) {
      renameSync(macOSDevAppBundle, macOSDevAppBackupBundle);
    }
    renameSync(appBundle, macOSDevAppBundle);
    writeFileSync(`${macOSDevAppFingerprintFile}.tmp`, sourceFingerprint);
    renameSync(`${macOSDevAppFingerprintFile}.tmp`, macOSDevAppFingerprintFile);
    rmSync(macOSDevAppPromotionFile);
  } catch (error) {
    try {
      recoverDevElectronAppPromotion();
    } catch (recoveryError) {
      throw new Error(
        `Nota Dev promotion and rollback failed. Keep ${macOSDevAppBackupBundle} and ` +
          `${macOSDevAppPromotionFile}; retry after fixing filesystem access. ` +
          `Recovery error: ${String(recoveryError)}`,
        { cause: error }
      );
    }
    throw error;
  }
  // Keep the previous bundle until the next promotion; it is no longer rollback state.
}

function prepareDevElectronForMacOSPermissions() {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    recoverDevElectronAppPromotion();
    const configuredIdentity = process.env.NOTA_DEV_CODESIGN_IDENTITY?.trim();
    const existingBundle = existsSync(macOSDevAppBundle);
    const existingIdentity = existingBundle
      ? readDevElectronSigningIdentity(macOSDevAppBundle)
      : null;
    if (existingBundle && !existingIdentity && !configuredIdentity) {
      throw new Error(
        'Cannot determine the cached Nota Dev signing identity. Restore the cached app ' +
          'or explicitly set NOTA_DEV_CODESIGN_IDENTITY before re-signing; changing ' +
          'identity may require granting macOS permissions again.'
      );
    }
    let signingIdentity: string | undefined;
    const ensureSigningIdentity = () =>
      (signingIdentity ??= selectDevSigningIdentity({
        existingIdentity,
        existingCertificateHash:
          !configuredIdentity && existingIdentity && existingIdentity !== '-'
            ? readDevElectronCertificateHash(macOSDevAppBundle)
            : undefined,
        configuredIdentity,
        availableIdentities:
          configuredIdentity === '-' ||
          (configuredIdentity && /^[0-9a-f]{40}$/i.test(configuredIdentity)) ||
          (!configuredIdentity && existingIdentity === '-')
            ? []
            : findMacOSDevCodeSigningIdentities(),
      }));
    const { appBundle, sourceFingerprint, needsReplacement } =
      readDevElectronAppCache();
    const infoPlist = resolve(appBundle, 'Contents', 'Info.plist');
    const metadataChanges = Object.entries({
      ...macOSDevElectronBundleMetadata,
      ...devElectronTccUsageDescriptions,
    }).filter(
      ([key, value]) => !devElectronPlistStringMatches(infoPlist, key, value)
    );

    const sourceIcon = resolve(
      electronDir,
      'resources',
      'icons',
      'icon_internal.icns'
    );
    const targetIcon = resolve(
      appBundle,
      'Contents',
      'Resources',
      'nota-dev.icns'
    );
    const iconChanged =
      !existsSync(targetIcon) ||
      !readFileSync(sourceIcon).equals(readFileSync(targetIcon));

    if (
      needsReplacement ||
      metadataChanges.length ||
      iconChanged ||
      !devElectronCodeSignatureIsValid(appBundle) ||
      (configuredIdentity &&
        !devElectronUsesSigningIdentity(appBundle, configuredIdentity))
    ) {
      const identity = ensureSigningIdentity();
      const stagingAppBundle = stageDevElectronAppBundle(appBundle);
      for (const [key, value] of metadataChanges) {
        execFileSync('/usr/bin/plutil', [
          '-replace',
          key,
          '-string',
          value,
          resolve(stagingAppBundle, 'Contents', 'Info.plist'),
        ]);
      }
      if (iconChanged) {
        copyFileSync(
          sourceIcon,
          resolve(stagingAppBundle, 'Contents', 'Resources', 'nota-dev.icns')
        );
      }
      if (identity === '-') {
        console.warn(
          'Nota Dev is using ad-hoc signing. Changes to this app bundle may require granting macOS permissions again.'
        );
      } else {
        console.log(`Signing Nota Dev with ${identity}`);
      }
      execFileSync('/usr/bin/codesign', [
        '--force',
        '--sign',
        identity,
        '--identifier',
        macOSDevAppBundleIdentifier,
        '--timestamp=none',
        stagingAppBundle,
      ]);
      if (!devElectronCodeSignatureIsValid(stagingAppBundle)) {
        throw new Error('the re-sealed Electron.app signature is invalid');
      }
      promoteDevElectronAppBundle(stagingAppBundle, sourceFingerprint);
    }
  } catch (error) {
    throw new Error(
      `Failed to prepare the local Electron permission identity: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  return macOSDevAppBundle;
}

function getRunningMacOSDevElectronPids() {
  const executable = resolve(
    macOSDevAppBundle,
    'Contents',
    'MacOS',
    'Electron'
  );
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,command='])
      .toString()
      .split('\n')
      .flatMap(line => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!match || !match[2].startsWith(executable)) {
          return [];
        }
        return [Number(match[1])];
      })
      .filter(pid => Number.isSafeInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>(resolve => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

function signalRunningMacOSDevElectron(signal: 'SIGTERM' | 'SIGKILL') {
  for (const pid of getRunningMacOSDevElectronPids()) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have exited between ps and kill.
    }
  }
}

function waitForMacOSDevElectronExit(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  return new Promise<boolean>(resolve => {
    const check = () => {
      if (getRunningMacOSDevElectronPids().length === 0) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function stopSpawnedElectron() {
  const currentSpawnProcess = spawnProcess;
  spawnProcess = null;

  if (process.platform === 'darwin') {
    signalRunningMacOSDevElectron('SIGTERM');
    const didAppExit = await waitForMacOSDevElectronExit(5000);
    if (!didAppExit) {
      signalRunningMacOSDevElectron('SIGKILL');
      await waitForMacOSDevElectronExit(1000);
    }
    if (currentSpawnProcess) {
      const didOpenExit = await waitForChildExit(currentSpawnProcess, 1000);
      if (!didOpenExit) {
        currentSpawnProcess.kill('SIGTERM');
        await waitForChildExit(currentSpawnProcess, 1000);
      }
    }
    stopMacOSDevLogTails();
    return;
  }

  const currentSpawnProcessId = currentSpawnProcess?.pid;
  if (currentSpawnProcessId) {
    await new Promise<void>((resolve, reject) => {
      kill(currentSpawnProcessId, 'SIGTERM', error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

function stopMacOSDevLogTails() {
  for (const tailProcess of logTailProcesses) {
    tailProcess.kill('SIGTERM');
  }
  logTailProcesses = [];
  rmSync(macOSDevBackendTokenFile, { force: true });
}

function startMacOSDevLogTails() {
  writeFileSync(macOSDevStdoutLog, '');
  writeFileSync(macOSDevStderrLog, '');
  const stdoutTail = spawn(
    '/usr/bin/tail',
    ['-n', '0', '-F', macOSDevStdoutLog],
    {
      cwd: electronDir,
    }
  );
  const stderrTail = spawn(
    '/usr/bin/tail',
    ['-n', '0', '-F', macOSDevStderrLog],
    {
      cwd: electronDir,
    }
  );
  stdoutTail.stdout.pipe(process.stdout);
  stderrTail.stdout.on('data', writeElectronStderr);
  for (const tailProcess of [stdoutTail, stderrTail]) {
    tailProcess.stderr.pipe(process.stderr);
  }
  logTailProcesses = [stdoutTail, stderrTail];
}

function startElectron() {
  const appBundle = prepareDevElectronForMacOSPermissions();

  const ext = process.platform === 'win32' ? '.cmd' : '';
  const exe = resolve(rootDir, 'node_modules', '.bin', `electron${ext}`);

  // remove import loader option
  const electronEnvironment = { ...process.env };
  const NODE_OPTIONS = electronEnvironment.NODE_OPTIONS;
  if (NODE_OPTIONS) {
    electronEnvironment.NODE_OPTIONS = NODE_OPTIONS.replace(
      /--import=[^\s]*/,
      ''
    );
  }

  if (appBundle) {
    const externalBackendToken =
      electronEnvironment.NOTA_AI_BACKEND_TOKEN?.trim();
    if (externalBackendToken) {
      rmSync(macOSDevBackendTokenFile, { force: true });
      writeFileSync(macOSDevBackendTokenFile, externalBackendToken, {
        mode: 0o600,
      });
      electronEnvironment.NOTA_AI_BACKEND_TOKEN_FILE = macOSDevBackendTokenFile;
    } else {
      rmSync(macOSDevBackendTokenFile, { force: true });
      delete electronEnvironment.NOTA_AI_BACKEND_TOKEN_FILE;
    }
    delete electronEnvironment.NOTA_AI_BACKEND_TOKEN;
  }

  if (appBundle) {
    startMacOSDevLogTails();
  }

  const launchedProcess = appBundle
    ? spawn(
        '/usr/bin/open',
        [
          '-n',
          '-W',
          '--fresh',
          '--stdout',
          macOSDevStdoutLog,
          '--stderr',
          macOSDevStderrLog,
          ...macOSDevForwardedEnvironmentKeys.flatMap(key => {
            const value = electronEnvironment[key];
            return value === undefined ? [] : ['--env', `${key}=${value}`];
          }),
          appBundle,
          '--args',
          electronDir,
          '--inspect',
          '--remote-debugging-port=9333',
        ],
        {
          cwd: electronDir,
          env: electronEnvironment,
        }
      )
    : spawn(exe, ['.', '--inspect', '--remote-debugging-port=9333'], {
        cwd: electronDir,
        env: electronEnvironment,
        shell: true,
      });
  spawnProcess = launchedProcess;

  launchedProcess.stdout.on('data', d => {
    const str = d.toString().trim();
    if (str) {
      console.log(str);
    }
  });

  launchedProcess.stderr.on('data', writeElectronStderr);

  // Stops the watch script when the application has quit
  launchedProcess.on('exit', code => {
    if (spawnProcess === launchedProcess) {
      spawnProcess = null;
      stopMacOSDevLogTails();
    }
    if (code && code !== 0) {
      console.log(`Electron exited with code ${code}`);
    }
  });
  launchedProcess.on('error', error => {
    if (spawnProcess === launchedProcess) {
      spawnProcess = null;
      stopMacOSDevLogTails();
    }
    console.error('Failed to launch Electron', error);
  });
}

function spawnOrReloadElectron() {
  if (watchMode) {
    return;
  }
  restartQueue = restartQueue
    .then(async () => {
      await stopSpawnedElectron();
      startElectron();
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

let isShuttingDown = false;
function shutDown(signal: 'SIGINT' | 'SIGTERM') {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  restartQueue.then(stopSpawnedElectron).then(
    () => process.exit(signal === 'SIGINT' ? 130 : 143),
    error => {
      console.error(error);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  );
}

if (!watchMode) {
  process.once('SIGINT', () => shutDown('SIGINT'));
  process.once('SIGTERM', () => shutDown('SIGTERM'));
}

const common = config();

async function watchLayers() {
  let initialBuild = false;
  return new Promise<BuildContext>(resolve => {
    const buildContextPromise = esbuild.context({
      ...common,
      plugins: [
        ...(common.plugins ?? []),
        {
          name: 'electron-dev:reload-app-on-layers-change',
          setup(build) {
            build.onEnd(() => {
              if (initialBuild) {
                console.log(`[layers] has changed, [re]launching electron...`);
                spawnOrReloadElectron();
              } else {
                buildContextPromise.then(resolve).catch(e => {
                  console.error(e);
                });
                initialBuild = true;
              }
            });
          },
        },
      ],
    });
    buildContextPromise
      .then(buildContext => {
        return buildContext.watch();
      })
      .catch(e => {
        console.error(e);
      });
  });
}

async function watchAiBackend() {
  let initialBuild = false;
  return new Promise<BuildContext>(resolve => {
    const buildContextPromise = esbuild.context({
      ...aiBackendConfig(),
      plugins: [
        {
          name: 'electron-dev:reload-app-on-ai-backend-change',
          setup(build) {
            build.onEnd(result => {
              if (result.errors.length) {
                return;
              }
              if (initialBuild) {
                console.log(
                  `[ai-backend] has changed, [re]launching electron...`
                );
                spawnOrReloadElectron();
              } else {
                buildContextPromise.then(resolve).catch(error => {
                  console.error(error);
                });
                initialBuild = true;
              }
            });
          },
        },
      ],
    });
    buildContextPromise
      .then(buildContext => buildContext.watch())
      .catch(error => {
        console.error(error);
      });
  });
}

await Promise.all([watchLayers(), watchAiBackend()]);

if (watchMode) {
  console.log(`Watching for changes...`);
} else {
  console.log('Starting electron...');
  spawnOrReloadElectron();
  console.log(`Electron is started, watching for changes...`);
}
