import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const electronRootDir = path.join(__dirname, '..');
const frontendRootDir = path.join(electronRootDir, '..', '..');
const iconsDir = path.join(electronRootDir, 'resources', 'icons');
const appIconSourcePath = path.join(iconsDir, 'icon-source.png');
const trayIconSourcePath = path.join(iconsDir, 'tray-source.png');
const glyphIconSourcePath = path.join(iconsDir, 'glyph-source.png');
const buildTypes = ['stable', 'beta', 'canary', 'internal'] as const;

const iosAppIconDir = path.join(
  frontendRootDir,
  'apps',
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset'
);
const iosSplashDir = path.join(
  frontendRootDir,
  'apps',
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'Splash.imageset'
);
const androidResDir = path.join(
  frontendRootDir,
  'apps',
  'android',
  'App',
  'app',
  'src',
  'main',
  'res'
);
const publicIconDirs = [
  path.join(frontendRootDir, 'core', 'public', 'imgs'),
  path.join(electronRootDir, 'resources', 'web-static', 'imgs'),
  path.join(frontendRootDir, 'apps', 'web', 'dist', 'imgs'),
  path.join(frontendRootDir, 'apps', 'electron-renderer', 'dist', 'imgs'),
];

const androidLauncherSizes = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
] as const;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: electronRootDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        stdout ? `stdout:\n${stdout}` : '',
        stderr ? `stderr:\n${stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    );
  }
}

function resizePng(sourcePath: string, size: number, outputPath: string) {
  fs.ensureDirSync(path.dirname(outputPath));
  run('sips', [
    '-z',
    String(size),
    String(size),
    sourcePath,
    '--out',
    outputPath,
  ]);
}

function convertToWebp(sourcePath: string, size: number, outputPath: string) {
  fs.ensureDirSync(path.dirname(outputPath));

  run('cwebp', [
    '-quiet',
    '-resize',
    String(size),
    String(size),
    sourcePath,
    '-o',
    outputPath,
  ]);
}

function composeCenteredIcon(options: {
  backgroundColor: string;
  canvasSize: number;
  outputPath: string;
  overlayPath: string;
  overlaySize: number;
}) {
  const { backgroundColor, canvasSize, outputPath, overlayPath, overlaySize } =
    options;

  fs.ensureDirSync(path.dirname(outputPath));

  run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${backgroundColor}:s=${canvasSize}x${canvasSize},format=rgba`,
    '-i',
    overlayPath,
    '-filter_complex',
    `[1:v]scale=${overlaySize}:${overlaySize}[icon];[0:v][icon]overlay=(W-w)/2:(H-h)/2:format=auto`,
    '-frames:v',
    '1',
    '-update',
    '1',
    outputPath,
  ]);
}

function generateIcns(sourcePath: string, outputPath: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-iconset-'));
  const iconsetPath = `${tempDir}.iconset`;

  fs.moveSync(tempDir, iconsetPath);

  try {
    const iconsetSizes = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ] as const;

    for (const [filename, size] of iconsetSizes) {
      resizePng(sourcePath, size, path.join(iconsetPath, filename));
    }

    run('iconutil', ['--convert', 'icns', '--output', outputPath, iconsetPath]);
  } finally {
    fs.removeSync(iconsetPath);
  }
}

function generateIco(sourcePath: string, outputPath: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-ico-'));

  try {
    const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const pngBuffers = icoSizes.map(size => {
      const pngPath = path.join(tempDir, `icon-${size}.png`);
      resizePng(sourcePath, size, pngPath);
      return fs.readFileSync(pngPath);
    });

    const directorySize = 6 + pngBuffers.length * 16;
    const header = Buffer.alloc(directorySize);

    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(pngBuffers.length, 4);

    let offset = directorySize;
    pngBuffers.forEach((buffer, index) => {
      const size = icoSizes[index];
      const entryOffset = 6 + index * 16;

      header.writeUInt8(size === 256 ? 0 : size, entryOffset);
      header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
      header.writeUInt8(0, entryOffset + 2);
      header.writeUInt8(0, entryOffset + 3);
      header.writeUInt16LE(1, entryOffset + 4);
      header.writeUInt16LE(32, entryOffset + 6);
      header.writeUInt32LE(buffer.length, entryOffset + 8);
      header.writeUInt32LE(offset, entryOffset + 12);

      offset += buffer.length;
    });

    fs.ensureDirSync(path.dirname(outputPath));
    fs.writeFileSync(outputPath, Buffer.concat([header, ...pngBuffers]));
  } finally {
    fs.removeSync(tempDir);
  }
}

function syncPublicIcoAssets(
  buildType: (typeof buildTypes)[number],
  iconPath: string
) {
  for (const dir of publicIconDirs) {
    if (!fs.pathExistsSync(dir)) {
      continue;
    }

    fs.copyFileSync(iconPath, path.join(dir, `app-icon-${buildType}.ico`));
  }
}

function generateAppIcons() {
  const finalAppIconPath = path.join(iconsDir, 'icon.png');

  fs.copyFileSync(appIconSourcePath, finalAppIconPath);

  for (const buildType of buildTypes) {
    const variantBase =
      buildType === 'stable'
        ? {
            iconPng: finalAppIconPath,
            iconIcns: path.join(iconsDir, 'icon.icns'),
            iconIco: path.join(iconsDir, 'icon.ico'),
            icon64: path.join(iconsDir, 'icon_stable_64x64.png'),
            icon512: path.join(iconsDir, 'icon_stable_512x512.png'),
          }
        : {
            iconPng: path.join(iconsDir, `icon_${buildType}.png`),
            iconIcns: path.join(iconsDir, `icon_${buildType}.icns`),
            iconIco: path.join(iconsDir, `icon_${buildType}.ico`),
            icon64: path.join(iconsDir, `icon_${buildType}_64x64.png`),
            icon512: path.join(iconsDir, `icon_${buildType}_512x512.png`),
          };

    if (buildType !== 'stable') {
      fs.copyFileSync(finalAppIconPath, variantBase.iconPng);
    }

    resizePng(finalAppIconPath, 64, variantBase.icon64);
    resizePng(finalAppIconPath, 512, variantBase.icon512);
    generateIcns(finalAppIconPath, variantBase.iconIcns);
    generateIco(finalAppIconPath, variantBase.iconIco);
    syncPublicIcoAssets(buildType, variantBase.iconIco);
  }
}

function generateTrayIcon() {
  resizePng(trayIconSourcePath, 64, path.join(iconsDir, 'tray-icon.png'));
}

function generateIosAssets() {
  fs.copyFileSync(appIconSourcePath, path.join(iosAppIconDir, 'light.png'));
  fs.copyFileSync(appIconSourcePath, path.join(iosAppIconDir, 'dark@1024.png'));
  fs.copyFileSync(
    trayIconSourcePath,
    path.join(iosAppIconDir, 'dark@trans.png')
  );

  for (const splashSize of [128, 256, 512]) {
    composeCenteredIcon({
      backgroundColor: '0x0C0C0C',
      canvasSize: splashSize,
      outputPath: path.join(iosSplashDir, `dark@${splashSize}.png`),
      overlayPath: trayIconSourcePath,
      overlaySize: Math.round(splashSize * 0.58),
    });
  }
}

function generateAndroidAssets() {
  const drawableNoDpiDir = path.join(androidResDir, 'drawable-nodpi');

  fs.ensureDirSync(drawableNoDpiDir);
  fs.copyFileSync(
    glyphIconSourcePath,
    path.join(drawableNoDpiDir, 'ic_launcher_foreground_nota.png')
  );
  fs.copyFileSync(
    glyphIconSourcePath,
    path.join(drawableNoDpiDir, 'ic_launcher_monochrome_nota.png')
  );

  for (const [dirName, size] of androidLauncherSizes) {
    convertToWebp(
      appIconSourcePath,
      size,
      path.join(androidResDir, dirName, 'ic_launcher.webp')
    );
    convertToWebp(
      appIconSourcePath,
      size,
      path.join(androidResDir, dirName, 'ic_launcher_round.webp')
    );
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error(
      'generate-icons requires macOS because it uses sips and iconutil.'
    );
  }

  await fs.access(appIconSourcePath);
  await fs.access(trayIconSourcePath);
  await fs.access(glyphIconSourcePath);

  generateAppIcons();
  generateTrayIcon();
  generateIosAssets();
  generateAndroidAssets();

  console.log('Generated Electron, iOS, Android, and shared app icons.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
