import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config';
import { prepareLocalModelSeed, verifyLocalModelSeed } from './meetings';
import { localModelById } from './model-registry';

const DEFAULT_SEED_MODEL_ID = 'whisper-tiny-en-onnx-q4';
const DEFAULT_WORKSPACE_ROOT = fileURLToPath(
  new URL('../../../..', import.meta.url)
);

function argumentValue(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv
    .slice(2)
    .find(argument => argument.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const modelId = argumentValue('--model') ?? DEFAULT_SEED_MODEL_ID;
const workspaceRoot = path.resolve(
  argumentValue('--workspace-root') ?? DEFAULT_WORKSPACE_ROOT
);
const verifyOnly = process.argv.includes('--verify-only');
const model = localModelById(modelId);

if (!model) {
  throw new Error(`Unknown local model: ${modelId}`);
}
if (model.releaseState !== 'ready') {
  throw new Error(
    `Local model ${model.id} is not release-ready (${model.releaseState ?? 'unspecified'}).`
  );
}

const config = {
  ...loadConfig(),
  settingsPath: path.join(workspaceRoot, '.nota', 'ai-settings.json'),
  workspaceRoot,
};
const seed = verifyOnly
  ? await verifyLocalModelSeed(config, model)
  : await prepareLocalModelSeed(config, model);

process.stdout.write(
  `${JSON.stringify({ ...seed, verified: true }, null, 2)}\n`
);
