import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, test } from 'vitest';

import {
  createLoopbackAuthRequestHandler,
  LOOPBACK_CALLBACK_TTL_MS,
  LOOPBACK_FLOW_QUERY_PARAM,
  LoopbackAuthFlowStore,
} from '../../src/main/auth/loopback-server';

const FLOW_A = 'a'.repeat(43);
const FLOW_B = 'b'.repeat(43);
const FLOW_C = 'c'.repeat(43);

let testServer: Server | null = null;

async function listen(store: LoopbackAuthFlowStore) {
  testServer = createServer(createLoopbackAuthRequestHandler(store));
  await new Promise<void>((resolve, reject) => {
    testServer?.once('error', reject);
    testServer?.listen(0, '127.0.0.1', resolve);
  });
  const address = testServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Loopback test server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  const active = testServer;
  testServer = null;
  if (active) {
    await new Promise<void>(resolve => active.close(() => resolve()));
  }
});

describe('Google OAuth loopback flow store', () => {
  test('generates independent 256-bit flow authorizations', () => {
    const store = new LoopbackAuthFlowStore();
    const first = store.begin().flowId;
    const second = store.begin().flowId;

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  test('keeps a callback private to its registered one-shot flow', () => {
    const store = new LoopbackAuthFlowStore({ createFlowId: () => FLOW_A });
    const flow = store.begin();
    const callback = new URL(flow.redirectUri);
    callback.searchParams.set('state', flow.flowId);
    callback.searchParams.set('code', 'direct-code');

    expect(store.acceptCallback(callback)).toEqual({
      flowId: FLOW_A,
      result: { code: 'direct-code' },
    });
    expect(store.poll(FLOW_B)).toBeNull();
    expect(store.poll('')).toBeNull();
    expect(store.poll(FLOW_A)).toEqual({ code: 'direct-code' });
    expect(store.poll(FLOW_A)).toBeNull();
  });

  test('accepts the existing broker redirect contract with a bound flow', () => {
    const store = new LoopbackAuthFlowStore({ createFlowId: () => FLOW_A });
    const flow = store.begin();
    const callback = new URL(flow.redirectUri);
    callback.searchParams.set(LOOPBACK_FLOW_QUERY_PARAM, flow.flowId);
    callback.searchParams.set('broker_code', 'broker-code');

    expect(store.acceptCallback(callback)).not.toBeNull();
    expect(store.poll(flow.flowId)).toEqual({ brokerCode: 'broker-code' });
  });

  test('rejects cancelled, expired, and pre-restart callbacks', () => {
    let now = 10_000;
    const flowIds = [FLOW_A, FLOW_B, FLOW_C];
    const store = new LoopbackAuthFlowStore({
      createFlowId: () => flowIds.shift() ?? FLOW_C,
      now: () => now,
    });

    const cancelled = store.begin();
    store.cancel(cancelled.flowId);
    const cancelledCallback = new URL(cancelled.redirectUri);
    cancelledCallback.searchParams.set('state', cancelled.flowId);
    cancelledCallback.searchParams.set('code', 'cancelled-code');
    expect(store.acceptCallback(cancelledCallback)).toBeNull();

    const expired = store.begin();
    now += LOOPBACK_CALLBACK_TTL_MS + 1;
    const expiredCallback = new URL(expired.redirectUri);
    expiredCallback.searchParams.set('state', expired.flowId);
    expiredCallback.searchParams.set('code', 'expired-code');
    expect(store.acceptCallback(expiredCallback)).toBeNull();

    const beforeRestart = store.begin();
    store.clear();
    const staleCallback = new URL(beforeRestart.redirectUri);
    staleCallback.searchParams.set('state', beforeRestart.flowId);
    staleCallback.searchParams.set('code', 'stale-code');
    expect(store.acceptCallback(staleCallback)).toBeNull();

    const afterRestart = store.begin();
    const currentCallback = new URL(afterRestart.redirectUri);
    currentCallback.searchParams.set('state', afterRestart.flowId);
    currentCallback.searchParams.set('code', 'current-code');
    expect(store.acceptCallback(currentCallback)).not.toBeNull();
    expect(store.poll(afterRestart.flowId)).toEqual({ code: 'current-code' });
  });

  test('does not expose OAuth results through an HTTP poll endpoint', async () => {
    const store = new LoopbackAuthFlowStore({ createFlowId: () => FLOW_A });
    const flow = store.begin();
    const baseUrl = await listen(store);

    const callback = new URL('/auth/callback', baseUrl);
    callback.searchParams.set('state', flow.flowId);
    callback.searchParams.set('code', 'private-code');
    const callbackResponse = await fetch(callback);
    expect(callbackResponse.status).toBe(200);
    const callbackHtml = await callbackResponse.text();
    expect(callbackHtml).not.toContain('private-code');
    expect(callbackHtml).not.toContain('postMessage');

    const response = await fetch(
      `${baseUrl}/auth/poll?flow=${encodeURIComponent(flow.flowId)}`,
      { headers: { Origin: 'https://attacker.example' } }
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(store.poll(flow.flowId)).toEqual({ code: 'private-code' });
  });

  test('rejects callbacks without a registered flow authorization', async () => {
    const store = new LoopbackAuthFlowStore({ createFlowId: () => FLOW_A });
    const baseUrl = await listen(store);

    const missingFlow = await fetch(
      `${baseUrl}/auth/callback?code=unbound-code`
    );
    expect(missingFlow.status).toBe(410);

    const wrongFlow = await fetch(
      `${baseUrl}/auth/callback?state=${FLOW_B}&code=wrong-flow-code`
    );
    expect(wrongFlow.status).toBe(410);
    expect(store.poll(FLOW_A)).toBeNull();
    expect(store.poll(FLOW_B)).toBeNull();
  });
});
