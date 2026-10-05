import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { dirname } from 'node:path';

import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

import { loadConfig } from '../../packages/backend/ai/src/config';
import { createLocalOnnxLanguageModel } from '../../packages/backend/ai/src/local-onnx-language-model';

async function main() {
  const [modelId, reportPath] = process.argv.slice(2);
  if (!modelId || !reportPath)
    throw new Error('Usage: local-chat-tool-smoke.ts MODEL_ID REPORT_PATH');
  const config = loadConfig();
  const calls: unknown[] = [];
  const errors: string[] = [];
  let firstTextMs: number | null = null;
  const started = performance.now();
  const result = streamText({
    model: createLocalOnnxLanguageModel({ config, modelId }),
    maxOutputTokens: modelId.includes('2.6b') ? 4096 : 512,
    abortSignal: AbortSignal.timeout(300000),
    maxRetries: 0,
    system:
      'You are testing Nota with synthetic content. Use the tool to find facts that are not in the question. Answer only from the returned result. Do not invent information.',
    prompt:
      'Who owns the Amber demo, and when is their review due? Use lookup_meeting; this information is only in that tool.',
    tools: {
      lookup_meeting: tool({
        description:
          'Look up one synthetic meeting by its id. Use id amber for the Amber demo.',
        inputSchema: z.object({ id: z.literal('amber') }),
        execute: async args => {
          calls.push(args);
          return {
            owner: 'Nora',
            reviewDue: 'October 9',
            source: 'Synthetic fixture',
          };
        },
      }),
    },
    stopWhen: stepCountIs(4),
    prepareStep: ({ stepNumber }) =>
      stepNumber >= 3 ? { activeTools: [], toolChoice: 'none' } : undefined,
  });
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta' && part.text.trim() && firstTextMs === null)
      firstTextMs = Math.round(performance.now() - started);
    if (part.type === 'error' || part.type === 'tool-error')
      errors.push(String(part.error));
  }
  const text = await result.text;
  const report = {
    modelId,
    recordedAt: new Date().toISOString(),
    hardware: {
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalRamGiB: totalmem() / 1024 ** 3,
      node: process.version,
    },
    totalMs: Math.round(performance.now() - started),
    firstTextMs,
    processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    calls,
    errors,
    output: text,
    fixturePassed:
      calls.length === 1 &&
      !errors.length &&
      /Nora/.test(text) &&
      /October 9|Oct\.? 9/.test(text),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
