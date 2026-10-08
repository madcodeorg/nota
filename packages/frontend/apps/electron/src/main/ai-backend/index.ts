import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { UtilityProcess } from 'electron';
import { app, utilityProcess } from 'electron';

import { beforeAppQuit } from '../cleanup';
import { logger } from '../logger';

// The local AI backend is bundled to `ai-server.js` alongside `main.js` (see
// scripts/build-layers.ts). We spawn it as a utility process and the renderer
// reaches it through the protocol proxy at http://localhost:<port>.
const AI_BACKEND_PATH = path.join(__dirname, './ai-server.js');

export const AI_BACKEND_HOST = '127.0.0.1';
export const AI_BACKEND_AUTH_HEADER = 'x-nota-backend-token';
const EXTERNAL_AI_BACKEND_URL = process.env.NOTA_AI_BACKEND_URL?.trim() || null;

function externalBackendToken() {
  const direct = process.env.NOTA_AI_BACKEND_TOKEN?.trim();
  if (direct) {
    return direct;
  }

  const tokenFile = process.env.NOTA_AI_BACKEND_TOKEN_FILE?.trim();
  if (!tokenFile) {
    return null;
  }
  try {
    return readFileSync(tokenFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const EXTERNAL_AI_BACKEND_TOKEN = externalBackendToken();
const AI_BACKEND_START_TIMEOUT_MS = 30_000;
const AI_BACKEND_SHUTDOWN_TIMEOUT_MS = 20_000;

function sherpaNativeLibraryPath() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return null;
  }
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const packageName = `sherpa-onnx-${platform}-${process.arch}`;
  if (app.isPackaged) {
    const packagedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      packageName
    );
    return existsSync(packagedPath) ? packagedPath : null;
  }
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
}

let backendProcess: UtilityProcess | null = null;
let backendBaseUrl = EXTERNAL_AI_BACKEND_URL?.replace(/\/$/, '') ?? null;
let backendAuthToken: string | null = EXTERNAL_AI_BACKEND_URL
  ? EXTERNAL_AI_BACKEND_TOKEN
  : randomBytes(32).toString('base64url');
let backendStartupError: string | null = null;

type BackendReadyMessage = {
  host: string;
  instanceId: string | null;
  port: number;
  type: 'nota-ai-backend-ready';
  workspaceRoot: string;
};

function isBackendReadyMessage(
  message: unknown
): message is BackendReadyMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const candidate = message as Partial<BackendReadyMessage>;
  return (
    candidate.type === 'nota-ai-backend-ready' &&
    typeof candidate.host === 'string' &&
    typeof candidate.instanceId === 'string' &&
    typeof candidate.port === 'number' &&
    Number.isSafeInteger(candidate.port) &&
    candidate.port > 0 &&
    typeof candidate.workspaceRoot === 'string'
  );
}

export function getAiBackendBaseUrl() {
  const status = getAiBackendStatus();
  if (!status.available || !backendBaseUrl) {
    throw new Error(
      status.error
        ? `Nota AI is unavailable: ${status.error}`
        : 'Nota AI backend has not finished starting.'
    );
  }
  return backendBaseUrl;
}

export function getAiBackendStatus() {
  return {
    available: backendBaseUrl !== null && backendStartupError === null,
    error: backendStartupError,
  };
}

export function withAiBackendAuth(headers?: RequestInit['headers']): Headers {
  if (!backendAuthToken) {
    throw new Error(
      'NOTA_AI_BACKEND_TOKEN is required when NOTA_AI_BACKEND_URL is set.'
    );
  }

  const authenticatedHeaders = new Headers(headers);
  authenticatedHeaders.set(AI_BACKEND_AUTH_HEADER, backendAuthToken);
  return authenticatedHeaders;
}

export function fetchAiBackend(pathname: string, init?: RequestInit) {
  return fetch(new URL(pathname, getAiBackendBaseUrl()), {
    ...init,
    headers: withAiBackendAuth(init?.headers),
    // Never carry the app credential across a backend-controlled redirect.
    redirect: 'manual',
  });
}

function clearSpawnedBackend(child: UtilityProcess) {
  if (backendProcess !== child) {
    return;
  }

  backendProcess = null;
  const previousBaseUrl = backendBaseUrl;
  backendBaseUrl = null;
  backendAuthToken = null;
  if (previousBaseUrl && process.env.NOTA_AI_BACKEND_URL === previousBaseUrl) {
    delete process.env.NOTA_AI_BACKEND_URL;
  }
}

function resolveSeededModelRoot() {
  const explicitRoot = process.env.NOTA_AI_SEEDED_MODEL_ROOT?.trim();
  if (explicitRoot) {
    return explicitRoot;
  }

  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'local-models');
  }

  const developmentModels = path.resolve(
    app.getAppPath(),
    '..',
    '..',
    '..',
    '..',
    '.nota',
    'models'
  );
  return existsSync(developmentModels) ? developmentModels : null;
}

function diagnosticReportSummary(report: string) {
  try {
    const parsed = JSON.parse(report) as {
      header?: { event?: unknown };
      javascriptHeap?: {
        availableMemory?: unknown;
        memoryLimit?: unknown;
        totalMemory?: unknown;
        usedMemory?: unknown;
      };
      javascriptStack?: { message?: unknown };
    };
    const heap = parsed.javascriptHeap;
    return JSON.stringify({
      event:
        typeof parsed.header?.event === 'string'
          ? parsed.header.event
          : undefined,
      heap:
        heap && typeof heap === 'object'
          ? {
              availableMemory: heap.availableMemory,
              memoryLimit: heap.memoryLimit,
              totalMemory: heap.totalMemory,
              usedMemory: heap.usedMemory,
            }
          : undefined,
      message:
        typeof parsed.javascriptStack?.message === 'string'
          ? parsed.javascriptStack.message
          : undefined,
    });
  } catch {
    // Node diagnostic reports include environment variables. Never write an
    // unparsed report to the app log where provider credentials could leak.
    return `unparseable diagnostic report (${Buffer.byteLength(report)} bytes)`;
  }
}

function pipeBackendOutput(
  stream: NodeJS.ReadableStream | null,
  log: (message: string) => void
) {
  if (!stream) {
    return;
  }
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    const message = String(chunk).trimEnd();
    if (message) {
      log(message);
    }
  });
}

function waitForBackendReady(
  child: UtilityProcess,
  input: { instanceId: string; workspaceRoot: string }
) {
  return new Promise<BackendReadyMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Nota AI backend did not report readiness within ${AI_BACKEND_START_TIMEOUT_MS}ms.`
        )
      );
    }, AI_BACKEND_START_TIMEOUT_MS);
    const onExit = (code: number) => {
      cleanup();
      reject(
        new Error(`Nota AI backend exited before readiness (code ${code}).`)
      );
    };
    const onMessage = (message: unknown) => {
      if (!isBackendReadyMessage(message)) {
        return;
      }
      if (
        message.instanceId !== input.instanceId ||
        path.resolve(message.workspaceRoot) !==
          path.resolve(input.workspaceRoot)
      ) {
        cleanup();
        reject(
          new Error('Nota AI backend reported a mismatched app instance.')
        );
        return;
      }
      cleanup();
      resolve(message);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('message', onMessage);
    };
    child.once('exit', onExit);
    child.on('message', onMessage);
  });
}

export async function requestAiBackendShutdown(
  child: UtilityProcess,
  timeoutMs = AI_BACKEND_SHUTDOWN_TIMEOUT_MS
) {
  if (child.pid === undefined) {
    return;
  }

  await new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.off('exit', finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      logger.warn(
        `[ai-backend] graceful shutdown exceeded ${timeoutMs}ms; terminating utility process`
      );
      child.kill();
      finish();
    }, timeoutMs);
    timeout.unref();
    child.once('exit', finish);

    try {
      child.postMessage({ type: 'nota-ai-backend-shutdown' });
    } catch (error) {
      logger.warn('[ai-backend] failed to request graceful shutdown', error);
      child.kill();
      finish();
    }
  });
}

export async function startAiBackend() {
  if (EXTERNAL_AI_BACKEND_URL) {
    if (!backendAuthToken) {
      throw new Error(
        'NOTA_AI_BACKEND_TOKEN is required when NOTA_AI_BACKEND_URL is set.'
      );
    }
    process.env.NOTA_AI_BACKEND_URL = backendBaseUrl ?? EXTERNAL_AI_BACKEND_URL;
    return null;
  }
  if (backendProcess) {
    return backendProcess;
  }

  // Persist models / settings under the app's user data dir so they survive
  // across launches and are isolated per build channel.
  const workspaceRoot =
    process.env.NOTA_AI_WORKSPACE_ROOT ?? app.getPath('userData');
  const seededModelRoot = resolveSeededModelRoot();
  const instanceId = randomUUID();
  const childAuthToken =
    backendAuthToken ??
    (backendAuthToken = randomBytes(32).toString('base64url'));
  const requestedPort = Number(process.env.NOTA_AI_PORT ?? 0);
  const sherpaLibraryPath = sherpaNativeLibraryPath();
  const nativeLibraryEnvironment = sherpaLibraryPath
    ? process.platform === 'darwin'
      ? {
          DYLD_LIBRARY_PATH: [sherpaLibraryPath, process.env.DYLD_LIBRARY_PATH]
            .filter(Boolean)
            .join(':'),
        }
      : {
          LD_LIBRARY_PATH: [sherpaLibraryPath, process.env.LD_LIBRARY_PATH]
            .filter(Boolean)
            .join(':'),
        }
    : {};

  const child = utilityProcess.fork(AI_BACKEND_PATH, [], {
    serviceName: 'nota-ai-backend',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...nativeLibraryEnvironment,
      NOTA_NATIVE_ASR_DIR: app.isPackaged
        ? path.join(process.resourcesPath, 'native')
        : path.resolve(__dirname, '../resources/native'),
      NOTA_AI_HOST: AI_BACKEND_HOST,
      NOTA_AI_BACKEND_TOKEN: childAuthToken,
      NOTA_AI_INSTANCE_ID: instanceId,
      NOTA_AI_PORT: String(
        Number.isSafeInteger(requestedPort) ? requestedPort : 0
      ),
      NOTA_AI_WORKSPACE_ROOT: workspaceRoot,
      ...(seededModelRoot
        ? { NOTA_AI_SEEDED_MODEL_ROOT: seededModelRoot }
        : {}),
    },
  });
  backendProcess = child;

  pipeBackendOutput(child.stdout, message => {
    logger.info(`[ai-backend] ${message}`);
  });
  pipeBackendOutput(child.stderr, message => {
    logger.error(`[ai-backend] ${message}`);
  });

  child.on('error', (type, location, report) => {
    logger.error(
      `[ai-backend] ${type} at ${location}: ${diagnosticReportSummary(report)}`
    );
  });

  child.once('spawn', () => {
    logger.info(
      `[ai-backend] forked pid=${child.pid} (workspaceRoot=${workspaceRoot})`
    );
  });

  child.on('exit', code => {
    logger.info(`[ai-backend] exited with code ${code}`);
    clearSpawnedBackend(child);
  });

  beforeAppQuit(() => requestAiBackendShutdown(child));

  let ready: BackendReadyMessage;
  try {
    ready = await waitForBackendReady(child, { instanceId, workspaceRoot });
  } catch (error) {
    clearSpawnedBackend(child);
    child.kill();
    throw error;
  }
  if (backendProcess !== child || child.pid === undefined) {
    clearSpawnedBackend(child);
    child.kill();
    throw new Error('Nota AI backend exited while reporting readiness.');
  }
  backendBaseUrl = `http://${AI_BACKEND_HOST}:${ready.port}`;
  process.env.NOTA_AI_BACKEND_URL = backendBaseUrl;
  logger.info(
    `[ai-backend] ready at ${backendBaseUrl} (workspaceRoot=${workspaceRoot}, instanceId=${instanceId})`
  );
  return child;
}

export async function startAiBackendSafely(
  start: typeof startAiBackend = startAiBackend
) {
  try {
    const child = await start();
    backendStartupError = null;
    return child;
  } catch (error) {
    backendStartupError =
      error instanceof Error ? error.message : String(error);
    logger.error(
      `[ai-backend] unavailable; continuing with the local notes workspace: ${backendStartupError}`
    );
    return null;
  }
}
