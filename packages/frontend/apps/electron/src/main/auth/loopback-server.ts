import { randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT = 41013;
export const LOOPBACK_CALLBACK_TTL_MS = 5 * 60 * 1000;
export const LOOPBACK_FLOW_QUERY_PARAM = 'nota_flow';

export type LoopbackAuthCallback = {
  brokerCode?: string;
  code?: string;
  error?: string;
};

export type LoopbackAuthFlow = {
  flowId: string;
  redirectUri: string;
};

type ActiveLoopbackAuthFlow = {
  expiresAt: number;
  result?: LoopbackAuthCallback;
};

type LoopbackAuthFlowStoreOptions = {
  createFlowId?: () => string;
  now?: () => number;
  ttlMs?: number;
};

const validFlowId = (value: string) => /^[A-Za-z0-9_-]{32,128}$/.test(value);

function randomFlowId() {
  return randomBytes(32).toString('base64url');
}

function callbackFlowId(url: URL) {
  const brokerFlow = url.searchParams.get(LOOPBACK_FLOW_QUERY_PARAM);
  const directFlow = url.searchParams.get('state');
  if (brokerFlow && directFlow && brokerFlow !== directFlow) {
    return null;
  }
  const flowId = brokerFlow ?? directFlow;
  return flowId && validFlowId(flowId) ? flowId : null;
}

function readCallbackPayload(url: URL): LoopbackAuthCallback | null {
  const brokerCode = url.searchParams.get('broker_code') ?? undefined;
  const code = url.searchParams.get('code') ?? undefined;
  const error = url.searchParams.get('error') ?? undefined;
  if (!brokerCode && !code && !error) return null;

  return {
    ...(brokerCode ? { brokerCode } : {}),
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
  };
}

/**
 * Holds only the OAuth flows explicitly opened by the trusted workspace
 * renderer. Results are read through IPC, never through an HTTP polling API.
 */
export class LoopbackAuthFlowStore {
  private readonly flows = new Map<string, ActiveLoopbackAuthFlow>();
  private readonly createFlowId: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: LoopbackAuthFlowStoreOptions = {}) {
    this.createFlowId = options.createFlowId ?? randomFlowId;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? LOOPBACK_CALLBACK_TTL_MS;
  }

  begin(): LoopbackAuthFlow {
    this.pruneExpired();
    let flowId = this.createFlowId();
    while (!validFlowId(flowId) || this.flows.has(flowId)) {
      flowId = this.createFlowId();
    }
    this.flows.set(flowId, { expiresAt: this.now() + this.ttlMs });
    return {
      flowId,
      redirectUri: `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/auth/callback`,
    };
  }

  acceptCallback(url: URL) {
    this.pruneExpired();
    const flowId = callbackFlowId(url);
    const result = readCallbackPayload(url);
    if (!flowId || !result) return null;

    const flow = this.flows.get(flowId);
    if (!flow) return null;
    flow.result = result;
    return { flowId, result };
  }

  poll(flowId: string): LoopbackAuthCallback | null {
    this.pruneExpired();
    if (!validFlowId(flowId)) return null;
    const flow = this.flows.get(flowId);
    if (!flow?.result) return null;

    this.flows.delete(flowId);
    return flow.result;
  }

  cancel(flowId: string) {
    if (validFlowId(flowId)) {
      this.flows.delete(flowId);
    }
  }

  clear() {
    this.flows.clear();
  }

  private pruneExpired() {
    const now = this.now();
    for (const [flowId, flow] of this.flows) {
      if (flow.expiresAt <= now) {
        this.flows.delete(flowId);
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCallbackPage(payload: LoopbackAuthCallback) {
  const isError = Boolean(payload.error);
  const title = isError ? 'Authentication failed' : 'Google approved Nota';
  const body = isError
    ? `Error: ${escapeHtml(payload.error ?? 'Unknown error')}`
    : 'Return to Nota to finish connecting Google Drive and Calendar.';

  return `<!DOCTYPE html>
<html><head><title>Nota - ${title}</title></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;margin:0;background:#fafafa;color:#202124">
<div style="text-align:center;max-width:420px;padding:24px">
<h2>${title}</h2>
<p>${body}</p>
</div></body></html>`;
}

export function createLoopbackAuthRequestHandler(store: LoopbackAuthFlowStore) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(
      req.url || '/',
      `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`
    );
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
      // OAuth results are intentionally unavailable over HTTP. The trusted
      // workspace renderer consumes them through its restricted IPC handler.
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const accepted = store.acceptCallback(url);
    if (!accepted) {
      res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'This Nota authorization request is invalid or no longer active.'
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderCallbackPage(accepted.result));
  };
}

const authFlows = new LoopbackAuthFlowStore();
let server: Server | null = null;
let serverStart: Promise<number> | null = null;

export function startLoopbackServer(): Promise<number> {
  if (server?.listening) return Promise.resolve(LOOPBACK_PORT);
  if (serverStart) return serverStart;

  const candidate = createServer(createLoopbackAuthRequestHandler(authFlows));
  serverStart = new Promise<number>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      candidate.removeListener('listening', onListening);
      if (server === candidate) server = null;
      reject(error);
    };
    const onListening = () => {
      candidate.removeListener('error', onError);
      server = candidate;
      resolve(LOOPBACK_PORT);
    };

    candidate.once('error', onError);
    candidate.once('listening', onListening);
    candidate.listen(LOOPBACK_PORT, LOOPBACK_HOST);
  }).finally(() => {
    serverStart = null;
  });

  return serverStart;
}

export async function beginLoopbackAuthFlow(): Promise<LoopbackAuthFlow> {
  await startLoopbackServer();
  return authFlows.begin();
}

export function pollLoopbackAuthFlow(flowId: string) {
  return authFlows.poll(flowId);
}

export function cancelLoopbackAuthFlow(flowId: string) {
  authFlows.cancel(flowId);
}

export async function stopLoopbackServer(): Promise<void> {
  authFlows.clear();
  if (serverStart) {
    await serverStart.catch(() => undefined);
  }

  const activeServer = server;
  server = null;
  if (!activeServer) return;
  await new Promise<void>(resolve => activeServer.close(() => resolve()));
}
