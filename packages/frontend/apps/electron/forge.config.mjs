import cp from 'node:child_process';
import {
  access,
  copyFile,
  cp as copyDirectory,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { notarize } from '@electron/notarize';
import { signApp } from '@electron/osx-sign';
import { utils } from '@electron-forge/core';
import { FusesPlugin } from '@electron-forge/plugin-fuses';

import {
  appIdMap,
  arch,
  buildType,
  icnsPath,
  iconUrl,
  iconX64PngPath,
  iconX512PngPath,
  icoPath,
  platform,
  productName,
} from './scripts/make-env.js';

const fromBuildIdentifier = utils.fromBuildIdentifier;

const linuxMimeTypes = [`x-scheme-handler/${productName.toLowerCase()}`];
const appBundleId = appIdMap[buildType];
const packagerAppBundleId = fromBuildIdentifier(appIdMap);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRootDir = path.resolve(__dirname, '..', '..', '..', '..');
const nativePackageSourceDir = path.resolve(__dirname, '..', '..', 'native');
const electronDistDir = path.resolve(__dirname, 'dist');
const macEntitlementsPath = path.resolve(
  __dirname,
  'resources',
  'entitlements.mac.plist'
);
const macHelperEntitlementsPath = path.resolve(
  __dirname,
  'resources',
  'entitlements.mac.helper.plist'
);
const execFileAsync = promisify(cp.execFile);
const rootNodeModulesDir = path.resolve(repoRootDir, 'node_modules');
const electronNodeModulesDir = path.resolve(__dirname, 'node_modules');
const aiBackendNodeModulesDir = path.resolve(
  repoRootDir,
  'packages',
  'backend',
  'ai',
  'node_modules'
);
const appleCodesignIdentity = process.env.APPLE_CODESIGN_IDENTITY?.trim();
const shouldSignMac =
  (platform === 'darwin' || platform === 'mas') &&
  Boolean(appleCodesignIdentity);
const shouldNotarizeMac =
  shouldSignMac &&
  Boolean(
    process.env.APPLE_ID &&
    process.env.APPLE_PASSWORD &&
    process.env.APPLE_TEAM_ID
  );
const enableCookieEncryption =
  process.env.NOTA_ENABLE_COOKIE_ENCRYPTION === '1' ||
  (shouldSignMac && process.env.NOTA_ENABLE_COOKIE_ENCRYPTION !== '0');

const DEFAULT_ELECTRON_LOCALES_KEEP = new Set([
  'en',
  'en_US',
  'en_GB',
  'zh_CN',
  'zh_TW',
  'fr',
  'es',
  'es_419',
  'pl',
  'de',
  'ru',
  'ja',
  'it',
  'ca',
  'da',
  'hi',
  'sv',
  'ur',
  'ar',
  'uk',
  'ko',
  'pt_BR',
  'fa',
  'nb',
]);

const AI_BACKEND_RUNTIME_PACKAGES = [
  '@huggingface/transformers',
  '@img/colour',
  'detect-libc',
  'onnxruntime-common',
  'onnxruntime-node',
  'semver',
  'sherpa-onnx-node',
  'sharp',
];

const sherpaRuntimePackage = (targetPlatform, targetArch) => {
  const runtimePlatform = targetPlatform === 'mas' ? 'darwin' : targetPlatform;
  if (runtimePlatform === 'darwin' && targetArch === 'arm64') {
    return 'sherpa-onnx-darwin-arm64';
  }
  if (runtimePlatform === 'darwin' && targetArch === 'x64') {
    return 'sherpa-onnx-darwin-x64';
  }
  if (runtimePlatform === 'linux' && targetArch === 'arm64') {
    return 'sherpa-onnx-linux-arm64';
  }
  if (runtimePlatform === 'linux' && targetArch === 'x64') {
    return 'sherpa-onnx-linux-x64';
  }
  if (runtimePlatform === 'win32' && targetArch === 'x64') {
    return 'sherpa-onnx-win-x64';
  }
  if (runtimePlatform === 'win32' && targetArch === 'ia32') {
    return 'sherpa-onnx-win-ia32';
  }
  throw new Error(
    `sherpa-onnx-node does not publish a runtime for ${runtimePlatform}-${targetArch}`
  );
};

const DEFAULT_SEEDED_LOCAL_MODELS = ['cactus-whistle', 'whisper-tiny-q5-cpp'];
const localModelSeedSourceRoot = path.resolve(
  process.env.NOTA_LOCAL_MODEL_SEED_SOURCE ??
    path.join(repoRootDir, '.nota', 'models')
);
const localModelSeedStagingRoot = path.join(electronDistDir, 'local-models');

const seededLocalModelIds = (() => {
  const explicitModels = process.env.NOTA_BUNDLE_LOCAL_MODELS?.trim();
  if (explicitModels) {
    return explicitModels
      .split(',')
      .map(modelId => modelId.trim())
      .filter(Boolean);
  }

  if (process.env.NOTA_BUNDLE_DEFAULT_STT_MODEL === '1') {
    return DEFAULT_SEEDED_LOCAL_MODELS;
  }

  return [];
})();

const sharpRuntimePackages = (targetPlatform, targetArch) => {
  const runtimePlatform = targetPlatform === 'mas' ? 'darwin' : targetPlatform;

  if (runtimePlatform === 'darwin') {
    if (targetArch !== 'arm64' && targetArch !== 'x64') {
      throw new Error(
        `Unsupported sharp target: ${runtimePlatform}-${targetArch}`
      );
    }

    return [
      `@img/sharp-${runtimePlatform}-${targetArch}`,
      `@img/sharp-libvips-${runtimePlatform}-${targetArch}`,
    ];
  }

  if (runtimePlatform === 'linux') {
    if (
      targetArch !== 'arm64' &&
      targetArch !== 'arm' &&
      targetArch !== 'x64'
    ) {
      throw new Error(
        `Unsupported sharp target: ${runtimePlatform}-${targetArch}`
      );
    }

    return [
      `@img/sharp-${runtimePlatform}-${targetArch}`,
      `@img/sharp-libvips-${runtimePlatform}-${targetArch}`,
    ];
  }

  if (runtimePlatform === 'win32') {
    if (
      targetArch !== 'arm64' &&
      targetArch !== 'ia32' &&
      targetArch !== 'x64'
    ) {
      throw new Error(
        `Unsupported sharp target: ${runtimePlatform}-${targetArch}`
      );
    }

    return [`@img/sharp-${runtimePlatform}-${targetArch}`];
  }

  throw new Error(`Unsupported sharp target: ${runtimePlatform}-${targetArch}`);
};

const nativeBinarySuffix = (targetPlatform, targetArch) => {
  switch (targetPlatform) {
    case 'darwin':
    case 'mas':
      if (targetArch === 'arm64') return 'darwin-arm64';
      if (targetArch === 'x64') return 'darwin-x64';
      if (targetArch === 'universal') return 'darwin-universal';
      break;
    case 'win32':
      if (targetArch === 'arm64') return 'win32-arm64-msvc';
      if (targetArch === 'ia32') return 'win32-ia32-msvc';
      return 'win32-x64-msvc';
    case 'linux':
      if (targetArch === 'arm64') return 'linux-arm64-gnu';
      if (targetArch === 'arm') return 'linux-arm-gnueabihf';
      return 'linux-x64-gnu';
  }

  throw new Error(
    `Unsupported @nota/native target: ${targetPlatform}-${targetArch}`
  );
};

const firstExistingPath = async candidates => {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next generated native artifact location.
    }
  }
  return null;
};

const copyFirstExistingFile = async (candidates, destination) => {
  const source = await firstExistingPath(candidates);
  if (!source) {
    throw new Error(
      `Unable to find required packaging artifact for ${path.basename(
        destination
      )}. Checked: ${candidates.join(', ')}`
    );
  }

  await copyFile(source, destination);
  return source;
};

const packageNameToPathParts = packageName => packageName.split('/');

const copyNodeRuntimePackage = async (packageName, nodeModulesDir) => {
  const packagePathParts = packageNameToPathParts(packageName);
  const sourceCandidates = [
    path.join(rootNodeModulesDir, ...packagePathParts),
    path.join(aiBackendNodeModulesDir, ...packagePathParts),
  ];
  const sourceDir = await firstExistingPath(sourceCandidates);
  const destinationDir = path.join(nodeModulesDir, ...packagePathParts);

  if (!sourceDir) {
    throw new Error(
      `Unable to find required AI backend runtime package ${packageName}. Checked: ${sourceCandidates.join(', ')}`
    );
  }

  await mkdir(path.dirname(destinationDir), { recursive: true });
  await copyDirectory(sourceDir, destinationDir, {
    dereference: true,
    recursive: true,
  });
};

const pruneOnnxRuntimeNodePackage = async (
  nodeModulesDir,
  targetPlatform,
  targetArch
) => {
  const runtimePlatform = targetPlatform === 'mas' ? 'darwin' : targetPlatform;
  const binRoot = path.join(
    nodeModulesDir,
    'onnxruntime-node',
    'bin',
    'napi-v6'
  );

  let platformEntries;
  try {
    platformEntries = await readdir(binRoot, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    platformEntries
      .filter(entry => entry.isDirectory() && entry.name !== runtimePlatform)
      .map(entry =>
        rm(path.join(binRoot, entry.name), { recursive: true, force: true })
      )
  );

  const platformRoot = path.join(binRoot, runtimePlatform);
  let archEntries;
  try {
    archEntries = await readdir(platformRoot, { withFileTypes: true });
  } catch {
    throw new Error(
      `onnxruntime-node does not include binaries for ${runtimePlatform}-${targetArch}`
    );
  }

  await Promise.all(
    archEntries
      .filter(entry => entry.isDirectory() && entry.name !== targetArch)
      .map(entry =>
        rm(path.join(platformRoot, entry.name), {
          recursive: true,
          force: true,
        })
      )
  );

  await access(path.join(platformRoot, targetArch, 'onnxruntime_binding.node'));
};

const copyAiBackendRuntimePackages = async (
  nodeModulesDir,
  targetPlatform,
  targetArch
) => {
  const packages = [
    ...AI_BACKEND_RUNTIME_PACKAGES,
    sherpaRuntimePackage(targetPlatform, targetArch),
    ...sharpRuntimePackages(targetPlatform, targetArch),
  ];

  for (const packageName of packages) {
    await copyNodeRuntimePackage(packageName, nodeModulesDir);
  }

  await pruneOnnxRuntimeNodePackage(nodeModulesDir, targetPlatform, targetArch);
};

const prepareSeededLocalModelResources = async () => {
  await rm(localModelSeedStagingRoot, { recursive: true, force: true });

  if (!seededLocalModelIds.length) {
    return;
  }

  for (const modelId of seededLocalModelIds) {
    const sourceDir = path.join(localModelSeedSourceRoot, modelId);
    const destinationDir = path.join(localModelSeedStagingRoot, modelId);

    await access(sourceDir);
    await mkdir(path.dirname(destinationDir), { recursive: true });
    await copyDirectory(sourceDir, destinationDir, {
      dereference: true,
      recursive: true,
    });
  }
};

const copyPackagedNodeModules = async (
  buildPath,
  targetPlatform,
  targetArch
) => {
  const nodeModulesDir = path.join(buildPath, 'node_modules');

  await rm(nodeModulesDir, { recursive: true, force: true });
  await Promise.all([
    copyNotaNativePackage(nodeModulesDir, targetPlatform, targetArch),
    copyAiBackendRuntimePackages(nodeModulesDir, targetPlatform, targetArch),
  ]);
};

const copyNotaNativePackage = async (
  nodeModulesDir,
  targetPlatform,
  targetArch
) => {
  const nativeDestinationDir = path.join(nodeModulesDir, '@nota', 'native');
  const suffix = nativeBinarySuffix(targetPlatform, targetArch);

  await mkdir(nativeDestinationDir, { recursive: true });

  await copyFile(
    path.join(nativePackageSourceDir, 'index.js'),
    path.join(nativeDestinationDir, 'index.js')
  );

  const packageJson = JSON.parse(
    await readFile(path.join(nativePackageSourceDir, 'package.json'), 'utf8')
  );
  await writeFile(
    path.join(nativeDestinationDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        main: packageJson.main,
        private: true,
      },
      null,
      2
    )}\n`
  );

  const notaBinaryName = `nota.${suffix}.node`;
  const affineBinaryName = `affine.${suffix}.node`;
  const binaryCandidates = [
    path.join(nativePackageSourceDir, notaBinaryName),
    path.join(electronDistDir, notaBinaryName),
    path.join(nativePackageSourceDir, affineBinaryName),
    path.join(electronDistDir, affineBinaryName),
  ];

  await copyFirstExistingFile(
    binaryCandidates,
    path.join(nativeDestinationDir, notaBinaryName)
  );
};

const getElectronLocalesKeep = () => {
  const raw = process.env.ELECTRON_LOCALES_KEEP?.trim();
  if (!raw) return DEFAULT_ELECTRON_LOCALES_KEEP;

  const normalized = raw.toLowerCase();
  if (normalized === 'all' || normalized === '*') return null;

  const keep = new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );

  // Always keep English as a safe fallback.
  keep.add('en');
  keep.add('en_US');
  keep.add('en_GB');
  return keep;
};

const getElectronPakLocalesKeep = keep => {
  const pakKeep = new Set();
  for (const locale of keep) {
    if (locale === 'en') {
      pakKeep.add('en-US');
      continue;
    }
    pakKeep.add(locale.replaceAll('_', '-'));
  }

  // Always keep English (US) as a safe fallback for Chromium/Electron locales.
  pakKeep.add('en');
  pakKeep.add('en-US');
  pakKeep.add('en-GB');
  return pakKeep;
};

const trimElectronFrameworkLocales = async (
  resourcesAppDir,
  targetPlatform
) => {
  if (process.env.TRIM_ELECTRON_LOCALES === '0') return;
  if (targetPlatform !== 'darwin' && targetPlatform !== 'mas') return;

  const keep = getElectronLocalesKeep();
  if (!keep) return;

  const contentsDir = path.resolve(resourcesAppDir, '..', '..');
  const frameworkResourcesDir = path.join(
    contentsDir,
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  let entries;
  try {
    entries = await readdir(frameworkResourcesDir, { withFileTypes: true });
  } catch {
    return;
  }
  const localeDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.endsWith('.lproj'))
    .map(entry => entry.name);

  await Promise.all(
    localeDirs.map(async dirName => {
      const locale = dirName.slice(0, -'.lproj'.length);
      if (keep.has(locale)) return;
      await rm(path.join(frameworkResourcesDir, dirName), {
        recursive: true,
        force: true,
      });
    })
  );
};

const trimElectronPakLocales = async (resourcesAppDir, targetPlatform) => {
  if (process.env.TRIM_ELECTRON_LOCALES === '0') return;
  if (targetPlatform !== 'win32' && targetPlatform !== 'linux') return;

  const keep = getElectronLocalesKeep();
  if (!keep) return;

  const rootDir = path.resolve(resourcesAppDir, '..', '..');
  const localesDir = path.join(rootDir, 'locales');

  let entries;
  try {
    entries = await readdir(localesDir, { withFileTypes: true });
  } catch {
    return;
  }

  const pakKeep = getElectronPakLocalesKeep(keep);

  await Promise.all(
    entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.pak'))
      .map(async entry => {
        const locale = entry.name.slice(0, -'.pak'.length);
        if (pakKeep.has(locale)) return;
        await rm(path.join(localesDir, entry.name), { force: true });
      })
  );
};

const resolvePackagedMacAppPath = buildPath =>
  buildPath.endsWith('.app')
    ? buildPath
    : path.join(buildPath, `${productName}.app`);

const removeMacInfoPlistKey = async (infoPlistPath, key) => {
  try {
    await execFileAsync('plutil', [
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      infoPlistPath,
    ]);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 1) return;
    throw error;
  }

  await execFileAsync('plutil', ['-remove', key, infoPlistPath]);
};

const sanitizeFinalMacInfoPlist = async (buildPath, targetPlatform) => {
  if (targetPlatform !== 'darwin' && targetPlatform !== 'mas') return;

  const infoPlistPath = path.join(
    resolvePackagedMacAppPath(buildPath),
    'Contents',
    'Info.plist'
  );
  await execFileAsync('plutil', ['-lint', infoPlistPath]);
  for (const key of [
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
  ]) {
    await removeMacInfoPlistKey(infoPlistPath, key);
  }

  // Electron's generated plist currently enables unrestricted network loads.
  // Nota only needs a loopback exception for the local AI/OAuth services, so
  // replace the final ATS dictionary before the bundle is signed.
  await execFileAsync('plutil', [
    '-replace',
    'NSAppTransportSecurity',
    '-json',
    JSON.stringify({ NSAllowsLocalNetworking: true }),
    infoPlistPath,
  ]);
};

const macSignOptions = appPath => {
  const mainAppPath = path.resolve(appPath);

  return {
    app: appPath,
    identity: appleCodesignIdentity,
    platform: 'darwin',
    hardenedRuntime: true,
    optionsForFile: filePath => {
      if (path.resolve(filePath) === mainAppPath) {
        return {
          entitlements: macEntitlementsPath,
        };
      }
      if (filePath.endsWith(`${productName} Helper.app`)) {
        return {
          entitlements: macHelperEntitlementsPath,
        };
      }

      return null;
    },
  };
};

const signFinalMacAppBundle = async (buildPath, targetPlatform) => {
  if (targetPlatform !== 'darwin' && targetPlatform !== 'mas') {
    return;
  }

  const appPath = resolvePackagedMacAppPath(buildPath);

  // Electron Forge signs during the package phase, but the Fuses plugin and our
  // afterPrune native-module copy run afterwards and invalidate that signature,
  // so we must re-sign here, in the final hook, after every bundle mutation.
  //
  // Do NOT use `codesign --deep` for the signed build: it re-seals the bundles
  // but leaves nested dylibs (libffmpeg, libEGL, and the onnxruntime/sherpa
  // native libs) ad-hoc signed. On modern macOS that is a Team ID mismatch and
  // the app aborts at launch ("mapping process and mapped file ... have
  // different Team IDs"). @electron/osx-sign signs inside-out and applies the
  // correct per-helper hardened-runtime entitlements (JIT, audio-input, camera).
  if (appleCodesignIdentity) {
    await signApp(macSignOptions(appPath));
    return;
  }

  // No signing identity: local / open-source ad-hoc build. There is no hardened
  // runtime and no Team ID here, so a single ad-hoc re-seal is enough to satisfy
  // the bundle's resource envelope after the fuse and native-module mutations.
  await new Promise((resolve, reject) => {
    cp.execFile(
      'codesign',
      [
        '--force',
        '--deep',
        '--sign',
        '-',
        '--identifier',
        appBundleId,
        appPath,
      ],
      error => (error ? reject(error) : resolve())
    );
  });
};

const notarizeFinalMacAppBundle = async (buildPath, targetPlatform) => {
  if (
    !shouldNotarizeMac ||
    (targetPlatform !== 'darwin' && targetPlatform !== 'mas')
  ) {
    return;
  }

  await notarize({
    appPath: resolvePackagedMacAppPath(buildPath),
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};

const makers = [
  !process.env.SKIP_BUNDLE &&
    platform === 'darwin' && {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULMO',
        icon: icnsPath,
        name: 'Nota',
        'icon-size': 128,
        background: path.join(
          __dirname,
          './resources/icons/dmg-background.png'
        ),
        contents: [
          {
            x: 176,
            y: 192,
            type: 'file',
            path: path.join(
              __dirname,
              'out',
              buildType,
              `${productName}-darwin-${arch}`,
              `${productName}.app`
            ),
          },
          { x: 432, y: 192, type: 'link', path: '/Applications' },
        ],
        iconSize: 118,
        file: path.join(
          __dirname,
          'out',
          buildType,
          `${productName}-darwin-${arch}`,
          `${productName}.app`
        ),
      },
    },
  {
    name: '@electron-forge/maker-zip',
    config: {
      name: 'nota',
      iconUrl: icoPath,
      setupIcon: icoPath,
      platforms: ['darwin', 'linux', 'win32'],
    },
  },
  !process.env.SKIP_BUNDLE && {
    name: '@electron-forge/maker-squirrel',
    config: {
      name: productName,
      setupIcon: icoPath,
      iconUrl: iconUrl,
      loadingGif: './resources/icons/nota_installing.gif',
    },
  },
  !process.env.SKIP_BUNDLE && {
    name: '@reforged/maker-appimage',
    platforms: ['linux'],
    /** @type {import('@reforged/maker-appimage').MakerAppImageConfig} */
    config: {
      options: {
        bin: productName,
        mimeType: linuxMimeTypes,
        productName,
        genericName: productName,
        categories: [
          'Office',
          'WordProcessor',
          'Presentation',
          'ContactManagement',
          'ProjectManagement',
          'VectorGraphics',
          'Chat',
        ],
        compressor: 'zstd',
        icon: { '64x64': iconX64PngPath, '512x512': iconX512PngPath },
      },
    },
  },
  !process.env.SKIP_BUNDLE && {
    name: '@electron-forge/maker-deb',
    config: {
      bin: productName,
      options: {
        name: productName,
        productName,
        icon: iconX512PngPath,
        mimeType: linuxMimeTypes,
        scripts: {
          // maker-deb does not have a way to include arbitrary files in package root
          // instead, put files in extraResource, and then install with a script
          postinst: './resources/deb/postinst',
          prerm: './resources/deb/prerm',
        },
      },
    },
  },
  !process.env.SKIP_BUNDLE && {
    name: '@electron-forge/maker-flatpak',
    platforms: ['linux'],
    /** @type {import('@electron-forge/maker-flatpak').MakerFlatpakConfig} */
    config: {
      options: {
        mimeType: linuxMimeTypes,
        productName,
        bin: productName,
        id: fromBuildIdentifier(appIdMap),
        icon: { '64x64': iconX64PngPath, '512x512': iconX512PngPath },
        branch: buildType,
        runtime: 'org.freedesktop.Platform',
        runtimeVersion: '25.08',
        sdk: 'org.freedesktop.Sdk',
        base: 'org.electronjs.Electron2.BaseApp',
        baseVersion: '25.08',
        files: [
          [
            './resources/nota.metainfo.xml',
            '/usr/share/metainfo/nota.metainfo.xml',
          ],
        ],
        modules: [
          {
            name: 'zypak',
            sources: [
              {
                type: 'git',
                url: 'https://github.com/refi64/zypak',
                tag: 'v2025.09',
              },
            ],
          },
        ],
        finishArgs: [
          // Wayland/X11 Rendering
          '--socket=wayland',
          '--socket=x11',
          '--share=ipc',
          // Open GL
          '--device=dri',
          // Audio output
          '--socket=pulseaudio',
          // Read/write home directory access
          '--filesystem=home',
          // Allow communication with network
          '--share=network',
          // System notifications with libnotify
          '--talk-name=org.freedesktop.Notifications',
        ],
      },
    },
  },
].filter(Boolean);

console.log('makers', makers);

/**
 * @type {import('@electron-forge/shared-types').ForgeConfig}
 */
export default {
  buildIdentifier: buildType,
  packagerConfig: {
    name: productName,
    appBundleId: packagerAppBundleId,
    appCategoryType: 'public.app-category.productivity',
    icon: icnsPath,
    osxSign: shouldSignMac
      ? {
          identity: appleCodesignIdentity,
          'hardened-runtime': true,
        }
      : undefined,
    electronZipDir: process.env.ELECTRON_FORGE_ELECTRON_ZIP_DIR,
    // Electron Packager notarizes before afterComplete. Nota must re-sign in
    // afterComplete because Forge's fuses/native copies mutate the bundle, so
    // notarization also runs there against the exact final signature.
    osxNotarize: undefined,
    // We need the following line for updater
    extraResource: [
      './resources/native',
      path.join(repoRootDir, 'LICENSE'),
      path.join(repoRootDir, 'NOTICE'),
      path.join(repoRootDir, 'THIRD_PARTY_NOTICES.md'),
      path.join(repoRootDir, 'licenses'),
      ...(platform === 'linux' ? ['./resources/nota.metainfo.xml'] : []),
      ...(seededLocalModelIds.length ? ['./dist/local-models'] : []),
    ],
    protocols: [
      {
        name: productName,
        schemes: [productName.toLowerCase()],
      },
    ],
    executableName: productName,
    ignore: [
      /\.map$/,
      // Build output dir — without this, each rebuild bundles the previous
      // build's `.app`/DMG into the new app.asar, recursively bloating it.
      /\/out($|\/)/,
      /\/test($|\/)/,
      /\/scripts($|\/)/,
      /\/examples($|\/)/,
      /\/docs($|\/)/,
      /^\/native($|\/)/,
      // Native helpers/addons are copied once as top-level Resources. Keeping
      // their source directory out of ASAR avoids a second unpacked copy.
      /^\/resources\/native($|\/)/,
      /^\/dist\/(?:helper|main|preload|shared)($|\/)/,
      // Seeded models are copied once via extraResource. Excluding the staging
      // directory prevents a second copy from being sealed inside app.asar.
      /^\/dist\/local-models($|\/)/,
      /^\/dist\/tsconfig\.tsbuildinfo$/,
      /\/README\.md$/,
      /\/forge\.config\.mjs$/,
      /\/dev-app-update\.yml$/,
    ],
    beforeCopyExtraResources: [
      (_buildPath, _electronVersion, _targetPlatform, _arch, done) => {
        prepareSeededLocalModelResources()
          .then(() => done())
          .catch(done);
      },
    ],
    afterCopy: [
      (buildPath, _electronVersion, targetPlatform, _arch, done) => {
        Promise.all([
          trimElectronFrameworkLocales(buildPath, targetPlatform),
          trimElectronPakLocales(buildPath, targetPlatform),
        ])
          .then(() => done())
          .catch(done);
      },
    ],
    afterPrune: [
      (buildPath, _electronVersion, targetPlatform, targetArch, done) => {
        copyPackagedNodeModules(buildPath, targetPlatform, targetArch)
          .then(() => done())
          .catch(done);
      },
    ],
    afterComplete: [
      (buildPath, _electronVersion, targetPlatform, _arch, done) => {
        sanitizeFinalMacInfoPlist(buildPath, targetPlatform)
          .then(() => signFinalMacAppBundle(buildPath, targetPlatform))
          .then(() => notarizeFinalMacAppBundle(buildPath, targetPlatform))
          .then(() => done())
          .catch(done);
      },
    ],
    asar: {
      unpack: 'node_modules/**/*',
      unpackDir: 'node_modules',
    },
    extendInfo: {
      // onnxruntime-node 1.24.3's darwin binding requires macOS 14. Declaring
      // the real floor prevents local AI/STT from failing after installation.
      LSMinimumSystemVersion: '14.0',
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      NSAudioCaptureUsageDescription:
        'Allow Nota to capture system audio while recording your meetings.',
      NSMicrophoneUsageDescription:
        'Please allow access so Nota can record meeting audio from your microphone.',
      NSCalendarsFullAccessUsageDescription:
        'Please allow access so Nota can show local calendar meetings before you start recording.',
      NSCalendarsUsageDescription:
        'Please allow access so Nota can show local calendar meetings before you start recording.',
      NSCalendarsWriteOnlyAccessUsageDescription:
        'Please allow access so Nota can show local calendar meetings before you start recording.',
    },
  },
  makers,
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      // Cookie encryption uses macOS Keychain. Keep it for signed release
      // builds, but do not enable it for local ad-hoc DMGs because each
      // rebuilt app has a new code signature and Keychain prompts again.
      [FuseV1Options.EnableCookieEncryption]: enableCookieEncryption,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    readPackageJson: async (_, packageJson) => {
      // we want different package name for canary build
      // so stable and canary will not share the same app data
      packageJson.productName = productName;
    },
    prePackage: async () => {
      await Promise.all([
        rm(path.join(__dirname, 'resources/native/Nota Calendar Helper.app'), {
          recursive: true,
          force: true,
        }),
        rm(
          path.join(__dirname, 'resources/native/nota-apple-calendar-helper'),
          { force: true }
        ),
      ]);
      // Forge's dependency walker only resolves from this package-local path.
      // Preserve a complete workspace-local install (used by CI), but replace
      // a partial directory with the repository install when dependencies are
      // hoisted there (used by local development).
      const dependencyMarkerParts = ['async-call-rpc', 'package.json'];
      const localDependencyMarker = path.join(
        electronNodeModulesDir,
        ...dependencyMarkerParts
      );
      if (!(await firstExistingPath([localDependencyMarker]))) {
        const rootDependencyMarker = path.join(
          rootNodeModulesDir,
          ...dependencyMarkerParts
        );
        if (!(await firstExistingPath([rootDependencyMarker]))) {
          throw new Error(
            `Unable to prepare Electron dependencies for packaging. Checked: ${localDependencyMarker}, ${rootDependencyMarker}`
          );
        }

        await rm(electronNodeModulesDir, {
          recursive: true,
          force: true,
        });
        await symlink(rootNodeModulesDir, electronNodeModulesDir);
      }
    },
    generateAssets: async (_, platform, arch) => {
      if (process.env.SKIP_GENERATE_ASSETS) {
        return;
      }

      // TODO(@Peng): right now we do not need the following
      // it is for octobase-node, but we dont use it for now.
      if (platform === 'darwin' && arch === 'arm64') {
        // In GitHub Actions runner, MacOS is always x64
        // we need to manually set TARGET to aarch64-apple-darwin
        process.env.TARGET = 'aarch64-apple-darwin';
      }

      const result = cp.spawnSync('yarn', ['generate-assets'], {
        stdio: 'inherit',
        cwd: __dirname,
        env: {
          ...process.env,
          NOTA_ELECTRON_TARGET_ARCH: arch,
          NOTA_ELECTRON_TARGET_PLATFORM: platform,
        },
      });

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        throw new Error(
          `Asset generation failed (${result.status ?? result.signal ?? 'unknown'}): yarn generate-assets`
        );
      }
    },
  },
};
