import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import path from 'node:path';

import type { AiBackendConfig } from './config';
import { localModelById } from './model-registry';

type LlamaMessage = {
  content: string;
  role: 'assistant' | 'system' | 'user';
};

type LlamaServer = {
  activeUses: number;
  child: ChildProcess;
  closing: boolean;
  exited: boolean;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  key: string;
  loaded: boolean;
  modelId: string;
  port: number;
  ready: Promise<void>;
  retireWhenIdle: boolean;
  stderr: string;
};

// A loaded model can hold several GB of GPU/unified memory. Keep one server,
// and release it when nobody has used it for a while.
const IDLE_MS = 10 * 60_000;
const START_TIMEOUT_MS = 180_000;
const servers = new Map<string, LlamaServer>();
// Set when the GPU start failed and the CPU retry was used.
let gpuFellBack = false;

export function llamaServerPath() {
  const binary =
    'nota-llama-server' + (process.platform === 'win32' ? '.exe' : '');
  const candidates = [
    process.env.NOTA_LLAMA_SERVER_PATH,
    process.env.NOTA_NATIVE_ASR_DIR &&
      path.join(process.env.NOTA_NATIVE_ASR_DIR, binary),
    path.join(
      process.cwd(),
      'packages/frontend/apps/electron/resources/native',
      binary
    ),
  ];
  return (
    candidates.find(
      (candidate): candidate is string => !!candidate && existsSync(candidate)
    ) ?? null
  );
}

export function llamaRuntimeAvailable() {
  return llamaServerPath() !== null;
}

// NOTA_LLM_GPU=0 forces the CPU. Otherwise every layer is offloaded to the GPU
// (Metal or Vulkan, when built in); llama.cpp falls back to the CPU itself when
// no usable device exists.
export function llamaExecutionProvider() {
  return process.env.NOTA_LLM_GPU === '0' || gpuFellBack
    ? 'llama-cpp-cpu'
    : 'llama-cpp-gpu';
}

function modelFile(config: AiBackendConfig, modelId: string) {
  const model = localModelById(modelId);
  const file = model?.files?.[0];
  if (!model || model.runtime !== 'llama.cpp' || !file) {
    throw new Error(`Unsupported llama.cpp text model: ${modelId}`);
  }
  return {
    contextTokens: model.contextWindowTokens ?? 32768,
    file: path.join(config.workspaceRoot, '.nota', 'models', modelId, file),
  };
}

function pidFile(config: AiBackendConfig) {
  return path.join(config.workspaceRoot, '.nota', 'llama-server.pid');
}

function abortError(signal: AbortSignal) {
  const reason = signal.reason;
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const error = new Error('Local generation was aborted.', { cause: reason });
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

// A hard crash of the parent leaves its helper running. Reap the one recorded
// by the previous run before starting another.
async function reapStaleServer(config: AiBackendConfig) {
  if (process.platform === 'win32') return;
  try {
    const pid = Number((await readFile(pidFile(config), 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 1) return;
    const name = await new Promise<string>(resolve =>
      execFile('ps', ['-p', String(pid), '-o', 'comm='], (_error, out) =>
        resolve(out ?? '')
      )
    );
    if (name.includes('nota-llama-server')) process.kill(pid, 'SIGKILL');
  } catch {
    // No previous run, or it already exited.
  }
}

function closeServer(server: LlamaServer) {
  if (server.closing) return;
  server.closing = true;
  clearTimeout(server.idleTimer);
  if (servers.get(server.key) === server) servers.delete(server.key);
  if (!server.exited) {
    server.child.kill('SIGTERM');
    const force = setTimeout(() => {
      if (!server.exited) server.child.kill('SIGKILL');
    }, 3000);
    force.unref?.();
  }
}

async function waitUntilHealthy(server: LlamaServer) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exited) {
      throw new Error(
        `The local model server stopped while loading ${server.modelId}. ${server.stderr.trim().slice(-400)}`
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      if (response.ok) return;
    } catch {
      // The port opens once the model starts loading.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out loading ${server.modelId}.`);
}

function startServer(config: AiBackendConfig, modelId: string): LlamaServer {
  const key = `${config.workspaceRoot}:${modelId}`;
  const { contextTokens, file } = modelFile(config, modelId);
  const helper = llamaServerPath();
  const server = { key, modelId } as LlamaServer;
  Object.assign(server, {
    activeUses: 0,
    closing: false,
    exited: false,
    idleTimer: undefined,
    loaded: false,
    retireWhenIdle: false,
    stderr: '',
  });
  const launch = async (binary: string, gpuLayers: string) => {
    server.exited = false;
    // The previous attempt's exit handler unregisters the server.
    if (!server.closing) servers.set(key, server);
    server.port = await freePort();
    const child = spawn(
      binary,
      [
        '-m',
        file,
        '-c',
        String(contextTokens),
        '-np',
        '1',
        '-ngl',
        gpuLayers,
        '--host',
        '127.0.0.1',
        '--port',
        String(server.port),
        '--jinja',
        '--no-webui',
        '--reasoning',
        'off',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
    );
    server.child = child;
    child.stderr?.on('data', chunk => {
      if (server.child === child) {
        server.stderr = (server.stderr + chunk).slice(-4000);
      }
    });
    child.once('exit', () => {
      // A replaced attempt must not mark its successor as stopped.
      if (server.child !== child) return;
      server.exited = true;
      if (servers.get(key) === server) servers.delete(key);
      rm(pidFile(config), { force: true }).catch(() => {});
    });
    child.once('error', error => {
      if (server.child !== child) return;
      server.exited = true;
      server.stderr += String(error);
    });
    await mkdir(path.dirname(pidFile(config)), { recursive: true });
    if (child.pid) await writeFile(pidFile(config), String(child.pid));
    try {
      await waitUntilHealthy(server);
    } catch (error) {
      if (!server.exited) child.kill('SIGKILL');
      throw error;
    }
  };
  server.ready = (async () => {
    if (!helper) {
      throw new Error('The local model runtime is not installed.');
    }
    if (!existsSync(file)) {
      throw new Error(`Model file is missing: ${file}`);
    }
    await reapStaleServer(config);
    const wantGpu = process.env.NOTA_LLM_GPU !== '0';
    try {
      await launch(helper, wantGpu ? '99' : '0');
      if (wantGpu) gpuFellBack = false;
    } catch (error) {
      if (!wantGpu) {
        closeServer(server);
        throw error;
      }
      // A GPU that is present but cannot load the model (out of memory, bad
      // driver) should not leave the user without chat. Retry once on CPU.
      console.warn(
        '[nota-llama] GPU start failed, retrying on CPU:',
        error instanceof Error ? error.message : String(error)
      );
      server.stderr = '';
      try {
        await launch(helper, '0');
        gpuFellBack = true;
      } catch (cpuError) {
        closeServer(server);
        throw cpuError;
      }
    }
    server.loaded = true;
  })();
  servers.set(key, server);
  // A failed start is reported to the request that acquired the lease.
  void server.ready.catch(() => {
    if (servers.get(key) === server) servers.delete(key);
  });
  return server;
}

function acquireServer(config: AiBackendConfig, modelId: string) {
  const key = `${config.workspaceRoot}:${modelId}`;
  let server = servers.get(key);
  if (!server || server.closing || server.exited) {
    server = startServer(config, modelId);
  }
  server.activeUses += 1;
  server.retireWhenIdle = false;
  clearTimeout(server.idleTimer);

  for (const other of servers.values()) {
    if (other === server) continue;
    other.retireWhenIdle = true;
    if (other.activeUses === 0) closeServer(other);
  }

  const held = server;
  let released = false;
  return {
    ready: held.ready.then(() => held),
    release: () => {
      if (released) return;
      released = true;
      held.activeUses -= 1;
      if (held.activeUses > 0) return;
      if (held.retireWhenIdle) {
        closeServer(held);
        return;
      }
      held.idleTimer = setTimeout(() => closeServer(held), IDLE_MS);
      held.idleTimer.unref?.();
    },
  };
}

export function closeLlamaServers() {
  for (const server of servers.values()) closeServer(server);
}

export function isLlamaTextResident(config: AiBackendConfig, modelId: string) {
  const server = servers.get(`${config.workspaceRoot}:${modelId}`);
  return !!server?.loaded && !server.closing && !server.exited;
}

export async function assertLlamaTextReady(
  config: AiBackendConfig,
  modelId: string
) {
  const lease = acquireServer(config, modelId);
  try {
    await lease.ready;
    return true;
  } catch (error) {
    throw new Error(
      `Local text model is not ready at ${modelFile(config, modelId).file}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    lease.release();
  }
}

async function postJson(
  server: LlamaServer,
  route: string,
  body: unknown,
  signal?: AbortSignal
) {
  const response = await fetch(`http://127.0.0.1:${server.port}${route}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Local model server returned ${response.status}: ${(await response.text()).slice(0, 300)}`
    );
  }
  return response;
}

// Count prompt tokens the same way generation will, so the answer budget never
// overruns the context window.
async function outputTokenBudget(
  server: LlamaServer,
  modelId: string,
  messages: LlamaMessage[],
  requestedTokens: number,
  signal?: AbortSignal
) {
  if (!Number.isInteger(requestedTokens) || requestedTokens < 1) {
    throw new Error('Local output token budget must be a positive integer.');
  }
  const contextWindow = localModelById(modelId)?.contextWindowTokens;
  if (!contextWindow) return requestedTokens;
  let promptTokens: number;
  try {
    const template = (await (
      await postJson(server, '/apply-template', { messages }, signal)
    ).json()) as { prompt?: string };
    const tokens = (await (
      await postJson(
        server,
        '/tokenize',
        {
          add_special: false,
          content: template.prompt ?? '',
          parse_special: true,
        },
        signal
      )
    ).json()) as { tokens?: unknown[] };
    if (!Array.isArray(tokens.tokens)) return requestedTokens;
    promptTokens = tokens.tokens.length;
  } catch {
    if (signal?.aborted) throw abortError(signal);
    return requestedTokens;
  }
  const remainingTokens = contextWindow - promptTokens;
  if (remainingTokens < 1) {
    throw new Error(
      `This prompt uses ${promptTokens.toLocaleString()} tokens, exceeding ${modelId}'s ${contextWindow.toLocaleString()} token context. Start a new chat or reduce the supplied context.`
    );
  }
  return Math.min(requestedTokens, remainingTokens);
}

export async function streamLlamaText(input: {
  abortSignal?: AbortSignal;
  config: AiBackendConfig;
  maxNewTokens?: number;
  messages: LlamaMessage[];
  modelId: string;
  onText?: (text: string) => void;
}) {
  throwIfAborted(input.abortSignal);
  const lease = acquireServer(input.config, input.modelId);
  try {
    const server = await lease.ready;
    throwIfAborted(input.abortSignal);
    const maxTokens = await outputTokenBudget(
      server,
      input.modelId,
      input.messages,
      input.maxNewTokens ?? 512,
      input.abortSignal
    );
    const response = await postJson(
      server,
      '/v1/chat/completions',
      {
        cache_prompt: true,
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: maxTokens,
        messages: input.messages,
        stream: true,
        temperature: 0,
      },
      input.abortSignal
    );
    if (!response.body) throw new Error('Local model returned no data.');

    let text = '';
    let pending = '';
    const decoder = new TextDecoder();
    const readEvent = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      const event = JSON.parse(data) as {
        choices?: { delta?: { content?: string | null } }[];
        error?: { message?: string };
      };
      if (event.error) {
        throw new Error(event.error.message ?? 'Local model failed.');
      }
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        input.onText?.(delta);
      }
    };
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          readEvent(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
      }
      readEvent(pending);
    } catch (error) {
      if (input.abortSignal?.aborted) throw abortError(input.abortSignal);
      throw error;
    }
    throwIfAborted(input.abortSignal);
    return text;
  } catch (error) {
    if (input.abortSignal?.aborted) throw abortError(input.abortSignal);
    throw error;
  } finally {
    lease.release();
  }
}

process.once('exit', closeLlamaServers);
