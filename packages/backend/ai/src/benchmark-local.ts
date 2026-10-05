import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { type AiBackendConfig, loadConfig } from './config';
import {
  localOnnxFilesComplete,
  type LocalOnnxMessage,
  streamLocalOnnxText,
} from './local-onnx';
import { isLocalOnnxTextModel, localModelById } from './model-registry';

const DEFAULT_WORKSPACE_ROOT = fileURLToPath(
  new URL('../../../..', import.meta.url)
);

// Deliberately synthetic: benchmarks never load the user's notes or meetings.
export const LOCAL_BENCHMARK_CASES = [
  {
    id: 'rewrite',
    prompt:
      'Rewrite this as one clear professional sentence. Preserve the date and do not add facts: ' +
      '"hey team, the offline notes demo is moved to September 18 because we still need to test recovery."',
    review:
      'One sentence; September 18 retained; recovery testing retained; no invented facts.',
  },
  {
    id: 'meeting',
    prompt:
      'Summarize this meeting in at most three bullets. Include the decision and each action with owner and due date. ' +
      'Do not invent a budget or a release date.\n' +
      'Avery: We will keep the pilot local-only. Cloud sync is out of scope.\n' +
      'Sam: I will test recording recovery by September 18.\n' +
      'Avery: I will update the onboarding checklist by September 19.\n' +
      'Sam: We have not approved a budget or a release date.',
    review:
      'Local-only pilot; Sam/recovery/September 18; Avery/onboarding/September 19; no invented budget or release date.',
  },
  {
    id: 'grounded-qa',
    prompt:
      'Answer using only the sources below, in one sentence with a source citation such as [1].\n' +
      '[1] Pilot plan: The pilot supports English and Spanish. The owner is Avery.\n' +
      '[2] Backlog: French support is deferred until after the pilot.\n' +
      'Question: Which languages does the pilot support?',
    review:
      'English and Spanish with [1]; French must not be a pilot language.',
  },
  {
    id: 'abstention',
    prompt:
      'Answer using only this source. If it does not answer the question, say "Not specified in the source."\n' +
      'Source: The local-only pilot starts September 18. Avery owns the pilot.\n' +
      'Question: What is the approved budget?',
    review: 'Abstains instead of inventing a budget.',
  },
] as const;

export function parseLocalBenchmarkArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string' },
      'workspace-root': { type: 'string' },
      'max-new-tokens': { type: 'string', default: '192' },
    },
    strict: true,
  });
  const model = localModelById(values.model ?? '');
  if (!model || !isLocalOnnxTextModel(model.id)) {
    throw new Error('--model must name a managed local ONNX text model.');
  }
  const maxNewTokens = Number(values['max-new-tokens']);
  if (
    !Number.isInteger(maxNewTokens) ||
    maxNewTokens < 16 ||
    maxNewTokens > 1024
  ) {
    throw new Error('--max-new-tokens must be an integer from 16 to 1024.');
  }
  return {
    maxNewTokens,
    modelId: model.id,
    workspaceRoot: path.resolve(
      values['workspace-root'] ?? DEFAULT_WORKSPACE_ROOT
    ),
  };
}

export async function runLocalBenchmark(
  input: {
    config: AiBackendConfig;
    modelId: string;
    maxNewTokens: number;
  },
  generate = streamLocalOnnxText
) {
  const cases = [
    { ...LOCAL_BENCHMARK_CASES[0], phase: 'cold' },
    ...LOCAL_BENCHMARK_CASES.map(item => ({ ...item, phase: 'warm' })),
  ];
  const results = [];
  for (const item of cases) {
    const started = performance.now();
    let firstTextMs: number | null = null;
    const messages: LocalOnnxMessage[] = [
      { role: 'user', content: item.prompt },
    ];
    const output = await generate({
      ...input,
      messages,
      onText: text => {
        if (text.trim() && firstTextMs === null) {
          firstTextMs = Math.round(performance.now() - started);
        }
      },
    });
    results.push({
      case: item.id,
      phase: item.phase,
      firstTextMs,
      totalMs: Math.round(performance.now() - started),
      // Node reports maxRSS in KiB on supported platforms. This is the
      // process-lifetime high-water mark, not an isolated model allocation.
      processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
      output,
      review: item.review,
    });
  }
  return {
    modelId: input.modelId,
    maxNewTokens: input.maxNewTokens,
    recordedAt: new Date().toISOString(),
    hardware: {
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalRamGiB: Math.round(os.totalmem() / 1024 ** 3),
      node: process.version,
    },
    notes: [
      'CPU-only; installed models only; no downloads or personal content.',
      'Cold includes runtime/model startup; warm reuses the same pipeline.',
      'First text is the first non-whitespace streamer callback, not time to first token.',
      'RSS is a process-lifetime high-water mark; run each model in a fresh process.',
      'Short synthetic tasks only. Review the output manually; this is not a quality score or an end-to-end app benchmark.',
    ],
    results,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseLocalBenchmarkArgs(process.argv.slice(2));
    const config = { ...loadConfig(), workspaceRoot: options.workspaceRoot };
    if (!(await localOnnxFilesComplete(config, options.modelId))) {
      throw new Error(
        `Install ${options.modelId} in ${path.join(options.workspaceRoot, '.nota', 'models')} first. This command never downloads models.`
      );
    }
    const report = await runLocalBenchmark({ ...options, config });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
