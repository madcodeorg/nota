import fs from 'node:fs';
import path from 'node:path';

const DARWIN_NATIVE_DYLIBS = [
  'libonnxruntime.1.17.1.dylib',
  'libsherpa-onnx-c-api.dylib',
];

function nativePackageRoot() {
  return path.dirname(require.resolve('@nota/native/package.json'));
}

function repoRootFromNativePackage(nativeRoot: string) {
  return path.resolve(nativeRoot, '../../..');
}

function dylibCandidateRoots(nativeRoot: string) {
  const repoRoot = repoRootFromNativePackage(nativeRoot);
  return [
    path.resolve(nativeRoot, '../apps/electron/dist'),
    path.resolve(repoRoot, 'packages/frontend/apps/electron/dist'),
    path.resolve(repoRoot, 'target/aarch64-apple-darwin/release/deps'),
    path.resolve(repoRoot, 'target/aarch64-apple-darwin/release'),
    path.resolve(repoRoot, 'target/aarch64-apple-darwin/debug/deps'),
    path.resolve(repoRoot, 'target/aarch64-apple-darwin/debug'),
    path.resolve(repoRoot, 'target/debug/deps'),
    path.resolve(repoRoot, 'target/debug'),
  ];
}

function linkOrCopy(source: string, destination: string) {
  try {
    fs.symlinkSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination);
  }
}

export function ensureNativeRecordingRuntimeDependencies() {
  if (process.platform !== 'darwin') {
    return {
      repaired: false,
      missing: [] as string[],
    };
  }

  const nativeRoot = nativePackageRoot();
  const candidateRoots = dylibCandidateRoots(nativeRoot);
  const missing: string[] = [];
  let repaired = false;

  for (const dylib of DARWIN_NATIVE_DYLIBS) {
    const destination = path.join(nativeRoot, dylib);
    if (fs.existsSync(destination)) {
      continue;
    }

    const source = candidateRoots
      .map(root => path.join(root, dylib))
      .find(candidate => fs.existsSync(candidate));

    if (!source) {
      missing.push(dylib);
      continue;
    }

    linkOrCopy(source, destination);
    repaired = true;
  }

  return {
    repaired,
    missing,
  };
}
