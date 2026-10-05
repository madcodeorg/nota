import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./copilot-client', () => ({
  handleError: (error: { status: number }) =>
    new Error(`Backend error ${error.status}`),
}));

import { toTextStream } from './event-source';

class TestEventSource extends EventTarget {
  static readonly CLOSED = 2;
  readyState = 1;

  close() {
    this.readyState = TestEventSource.CLOSED;
  }

  message(data: string, type = 'message') {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }

  finish(data?: string) {
    this.dispatchEvent(new MessageEvent('error', { data }));
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', TestEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toTextStream completion', () => {
  test('drains the queued proposal, attachment and final answer after the connection closes', async () => {
    const source = new TestEventSource();
    const iterator = toTextStream(source as unknown as EventSource)[
      Symbol.asyncIterator
    ]();
    const first = iterator.next();
    const proposal = JSON.stringify({
      type: 'tool-result',
      toolName: 'propose_nota_action',
      result: { proposal: { status: 'pending_approval' } },
    });
    source.message(proposal);
    source.message('attachment-1', 'attachment');
    source.message('Please approve the note proposal.');
    source.finish();

    expect(await first).toEqual({
      done: false,
      value: { type: 'message', data: proposal },
    });
    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: 'attachment', data: 'attachment-1' },
    });
    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: 'message', data: 'Please approve the note proposal.' },
    });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test('stops without delivering queued messages when the user aborts', async () => {
    const source = new TestEventSource();
    const controller = new AbortController();
    const iterator = toTextStream(source as unknown as EventSource, {
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const first = iterator.next();
    source.message('Thinking');
    expect((await first).value).toEqual({ type: 'message', data: 'Thinking' });
    source.message('Queued answer');
    controller.abort();
    source.close();

    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test('propagates backend errors while waiting for a message', async () => {
    const source = new TestEventSource();
    const iterator = toTextStream(source as unknown as EventSource)[
      Symbol.asyncIterator
    ]();
    const next = iterator.next();
    source.finish(JSON.stringify({ status: 500 }));

    await expect(next).rejects.toThrow('Backend error 500');
    expect(source.readyState).toBe(TestEventSource.CLOSED);
  });
});
