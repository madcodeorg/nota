import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiBackendConfig } from './config';
import {
  assertLlamaTextReady,
  closeLlamaServers,
  isLlamaTextResident,
  llamaExecutionProvider,
  llamaServerPath,
  streamLlamaText,
} from './local-llama';
import { createLocalOnnxLanguageModel } from './local-onnx-language-model';
import { localModelById } from './model-registry';

const MODEL_ID = 'qwen3.5-0.8b-gguf-q4km';

// Windows cannot execute a shebang script directly. Run only this fixture with
// Node, keeping the real child-process/server lifecycle in these tests.
const fixture = vi.hoisted(() => ({ helper: '' }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) =>
      process.platform === 'win32' && args[0] === fixture.helper
        ? actual.spawn(
            process.execPath,
            [args[0], ...(args[1] as string[])],
            args[2]
          )
        : actual.spawn(...args),
  };
});

// Stands in for llama-server: same flags, /health, /apply-template, /tokenize
// and an SSE /v1/chat/completions. It records its arguments next to itself.
const FAKE_SERVER = `#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
fs.writeFileSync(__filename + '.args', JSON.stringify(args));
const body = req => new Promise(resolve => {
  let data = '';
  req.on('data', chunk => (data += chunk));
  req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});
http.createServer(async (req, res) => {
  if (req.url === '/health') return res.end('{"status":"ok"}');
  const input = await body(req);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/apply-template') return res.end(JSON.stringify({ prompt: 'a b c' }));
  if (req.url === '/tokenize') return res.end(JSON.stringify({ tokens: [1, 2, 3] }));
  fs.writeFileSync(__filename + '.request', JSON.stringify(input));
  res.setHeader('content-type', 'text/event-stream');
  for (const piece of ['Hello', ', ', 'world']) {
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\\n\\n');
  }
  res.end('data: [DONE]\\n\\n');
}).listen(port, '127.0.0.1');
`;

let root = '';
let helper = '';
let config: AiBackendConfig;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-llama-'));
  helper = path.join(root, 'nota-llama-server');
  fixture.helper = helper;
  await writeFile(helper, FAKE_SERVER);
  await chmod(helper, 0o755);
  vi.stubEnv('NOTA_LLAMA_SERVER_PATH', helper);
  const file = localModelById(MODEL_ID)!.files![0];
  const modelPath = path.join(root, '.nota', 'models', MODEL_ID, file);
  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, 'fixture');
  config = { workspaceRoot: root } as AiBackendConfig;
});

afterEach(async () => {
  closeLlamaServers();
  vi.unstubAllEnvs();
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

describe('local llama.cpp runtime', () => {
  it.each(['generate', 'stream'] as const)(
    'enforces the SDK JSON schema during %s',
    async mode => {
      await writeFile(
        helper,
        FAKE_SERVER.replace(
          "['Hello', ', ', 'world']",
          '[\'{"remove":[],"fixes":[]}\']'
        )
      );
      const responseFormat: Extract<
        LanguageModelV3CallOptions['responseFormat'],
        { type: 'json' }
      > = {
        type: 'json' as const,
        name: 'transcript_check',
        schema: {
          type: 'object' as const,
          properties: {
            remove: { type: 'array', items: { type: 'string' } },
            fixes: { type: 'array', items: { type: 'string' } },
          },
          required: ['remove', 'fixes'],
          additionalProperties: false,
        },
      };
      const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });
      const options = {
        prompt: [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: 'Check this transcript.' },
            ],
          },
        ],
        responseFormat,
      };
      if (mode === 'generate') {
        const result = await model.doGenerate(options);
        expect(result.content).toEqual([
          { type: 'text', text: '{"remove":[],"fixes":[]}' },
        ]);
        expect(result.warnings).not.toContainEqual(
          expect.objectContaining({ feature: 'responseFormat' })
        );
      } else {
        const result = await model.doStream(options);
        const parts = [];
        const reader = result.stream.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          parts.push(next.value);
        }
        expect(parts).toContainEqual(
          expect.objectContaining({
            type: 'text-delta',
            delta: '{"remove":[],"fixes":[]}',
          })
        );
        expect(parts.some(part => part.type === 'error')).toBe(false);
      }
      const request = JSON.parse(await readFile(helper + '.request', 'utf8'));
      expect(request.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'transcript_check',
          schema: responseFormat.schema,
          strict: true,
        },
      });
    }
  );

  it('requests plain JSON when no schema is supplied', async () => {
    await streamLlamaText({
      config,
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: 'Hi' }],
      responseFormat: { type: 'json' },
    });
    const request = JSON.parse(await readFile(helper + '.request', 'utf8'));
    expect(request.response_format).toEqual({ type: 'json_object' });
  });

  it('rejects a stream that closes without the completion marker', async () => {
    await writeFile(
      helper,
      FAKE_SERVER.replace("res.end('data: [DONE]\\n\\n');", 'res.end();')
    );
    const pieces: string[] = [];
    await expect(
      streamLlamaText({
        config,
        modelId: MODEL_ID,
        messages: [{ role: 'user', content: 'Hi' }],
        onText: piece => pieces.push(piece),
      })
    ).rejects.toThrow('interrupted');
    expect(pieces.join('')).toBe('Hello, world');
  });

  it('rejects a response cut off by the token limit', async () => {
    await writeFile(
      helper,
      FAKE_SERVER.replace(
        "res.end('data: [DONE]\\n\\n');",
        "res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }) + '\\n\\ndata: [DONE]\\n\\n');"
      )
    );
    await expect(
      streamLlamaText({
        config,
        modelId: MODEL_ID,
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toThrow('token limit');
  });

  it('reports an interrupted chat through the SDK error stream', async () => {
    await writeFile(
      helper,
      FAKE_SERVER.replace("res.end('data: [DONE]\\n\\n');", 'res.end();')
    );
    const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });
    const onError = vi.fn();
    const result = streamText({ model, prompt: 'Hi', maxRetries: 0, onError });
    let partialText = '';
    const errors: unknown[] = [];
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') partialText += part.text;
      if (part.type === 'error') errors.push(part.error);
    }
    expect(partialText).toBe('Hello, world');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: expect.stringContaining('interrupted'),
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('finds the helper from NOTA_LLAMA_SERVER_PATH', () => {
    expect(llamaServerPath()).toBe(helper);
  });

  it('reports the GPU unless NOTA_LLM_GPU=0', () => {
    expect(llamaExecutionProvider()).toBe('llama-cpp-gpu');
    vi.stubEnv('NOTA_LLM_GPU', '0');
    expect(llamaExecutionProvider()).toBe('llama-cpp-cpu');
  });

  it('streams text from the server and offloads all layers to the GPU', async () => {
    const pieces: string[] = [];
    const text = await streamLlamaText({
      config,
      messages: [{ content: 'Hi', role: 'user' }],
      modelId: MODEL_ID,
      onText: piece => pieces.push(piece),
    });
    expect(text).toBe('Hello, world');
    expect(pieces).toEqual(['Hello', ', ', 'world']);
    expect(isLlamaTextResident(config, MODEL_ID)).toBe(true);

    const args = JSON.parse(
      await readFile(helper + '.args', 'utf8')
    ) as string[];
    expect(args[args.indexOf('-ngl') + 1]).toBe('99');
    expect(args).toContain('--jinja');
    const request = JSON.parse(await readFile(helper + '.request', 'utf8'));
    expect(request).toMatchObject({ stream: true, temperature: 0 });
  });

  it('uses the CPU when NOTA_LLM_GPU=0', async () => {
    vi.stubEnv('NOTA_LLM_GPU', '0');
    await assertLlamaTextReady(config, MODEL_ID);
    const args = JSON.parse(
      await readFile(helper + '.args', 'utf8')
    ) as string[];
    expect(args[args.indexOf('-ngl') + 1]).toBe('0');
  });

  it('retries on the CPU when the GPU start fails', async () => {
    // Exits like a server that cannot allocate GPU memory.
    await writeFile(
      helper,
      FAKE_SERVER.replace(
        "fs.writeFileSync(__filename + '.args', JSON.stringify(args));",
        "if (args[args.indexOf('-ngl') + 1] !== '0') { console.error('out of memory'); process.exit(1); }\nfs.writeFileSync(__filename + '.args', JSON.stringify(args));"
      )
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await assertLlamaTextReady(config, MODEL_ID);
    const args = JSON.parse(
      await readFile(helper + '.args', 'utf8')
    ) as string[];
    expect(args[args.indexOf('-ngl') + 1]).toBe('0');
    expect(isLlamaTextResident(config, MODEL_ID)).toBe(true);
    expect(llamaExecutionProvider()).toBe('llama-cpp-cpu');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reuses the resident server for the next request', async () => {
    await streamLlamaText({
      config,
      messages: [{ content: 'one', role: 'user' }],
      modelId: MODEL_ID,
    });
    const pid = await readFile(
      path.join(root, '.nota', 'llama-server.pid'),
      'utf8'
    );
    await streamLlamaText({
      config,
      messages: [{ content: 'two', role: 'user' }],
      modelId: MODEL_ID,
    });
    expect(
      await readFile(path.join(root, '.nota', 'llama-server.pid'), 'utf8')
    ).toBe(pid);
  });

  it('stops the server when asked to close', async () => {
    await assertLlamaTextReady(config, MODEL_ID);
    closeLlamaServers();
    expect(isLlamaTextResident(config, MODEL_ID)).toBe(false);
  });

  it('rejects when the model file is missing', async () => {
    await rm(path.join(root, '.nota', 'models'), { recursive: true });
    await expect(assertLlamaTextReady(config, MODEL_ID)).rejects.toThrow(
      /Model file is missing/
    );
  });

  it('aborts a request that was cancelled before it started', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamLlamaText({
        abortSignal: controller.signal,
        config,
        messages: [{ content: 'Hi', role: 'user' }],
        modelId: MODEL_ID,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
