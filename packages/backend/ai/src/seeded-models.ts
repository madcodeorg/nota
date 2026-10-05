import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AiBackendConfig } from './config';
import { localModelById, requiredFilesFor } from './model-registry';

const execFileAsync = promisify(execFile);

async function copySeededModel(source: string, destination: string) {
  if (process.platform === 'darwin') {
    try {
      // APFS clone-copy reuses immutable model extents and keeps first launch
      // fast even when a bundled model is several gigabytes.
      await execFileAsync('/bin/cp', ['-cR', source, destination]);
      return;
    } catch {
      // Fall back to Node's portable recursive copy below.
    }
  }

  await cp(source, destination, {
    dereference: true,
    recursive: true,
  });
}

function seededModelRoot() {
  const modelRoot = process.env.NOTA_AI_SEEDED_MODEL_ROOT?.trim();
  if (!modelRoot) {
    return null;
  }

  return modelRoot;
}

function requiredModelFilesComplete(modelId: string, modelRoot: string) {
  const requiredFiles = requiredFilesFor(modelId);
  if (!requiredFiles.length) {
    return false;
  }

  return requiredFiles.every(fileName => {
    const filePath = path.join(modelRoot, fileName);

    try {
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  });
}

function safeModelDestination(modelsRoot: string, modelId: string) {
  const destination = path.join(modelsRoot, modelId);
  const relative = path.relative(modelsRoot, destination);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe seeded model path: ${modelId}`);
  }

  return destination;
}

export async function installSeededLocalModels(config: AiBackendConfig) {
  const seedRoot = seededModelRoot();
  if (!seedRoot || !existsSync(seedRoot)) {
    return;
  }

  const modelsRoot = path.join(config.workspaceRoot, '.nota', 'models');
  await mkdir(modelsRoot, { recursive: true });

  for (const entry of await readdir(seedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !localModelById(entry.name)) {
      continue;
    }

    const source = path.join(seedRoot, entry.name);
    if (!requiredModelFilesComplete(entry.name, source)) {
      console.warn(
        `[seeded-models] skipped incomplete seeded model ${entry.name}`
      );
      continue;
    }

    const destination = safeModelDestination(modelsRoot, entry.name);
    if (requiredModelFilesComplete(entry.name, destination)) {
      continue;
    }

    const temporaryDestination = safeModelDestination(
      modelsRoot,
      `.seed-${entry.name}-${process.pid}`
    );

    await rm(temporaryDestination, { recursive: true, force: true });
    await copySeededModel(source, temporaryDestination);

    if (!requiredModelFilesComplete(entry.name, temporaryDestination)) {
      await rm(temporaryDestination, { recursive: true, force: true });
      console.warn(
        `[seeded-models] copied seeded model ${entry.name}, but required files were still missing`
      );
      continue;
    }

    await rm(destination, { recursive: true, force: true });
    await rename(temporaryDestination, destination);
    console.info(`[seeded-models] installed seeded local model ${entry.name}`);
  }
}
