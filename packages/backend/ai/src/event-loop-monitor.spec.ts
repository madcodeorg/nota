import { afterEach, describe, expect, it } from 'vitest';

import {
  eventLoopLag,
  startEventLoopMonitor,
  stopEventLoopMonitor,
} from './event-loop-monitor';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

afterEach(() => stopEventLoopMonitor());

describe('event loop monitor', () => {
  it('reports no lag before it starts', () => {
    expect(eventLoopLag()).toEqual({ maxMs: 0, p99Ms: 0 });
  });

  it('reports a synchronous stall', async () => {
    startEventLoopMonitor({ windowMs: 50 });
    await sleep(30);
    const until = Date.now() + 200;
    while (Date.now() < until) {
      // Block the event loop on purpose.
    }
    await sleep(150);

    expect(eventLoopLag().maxMs).toBeGreaterThanOrEqual(120);
  });

  it('forgets stalls once they leave the retained windows', async () => {
    startEventLoopMonitor({ windowMs: 20 });
    const until = Date.now() + 100;
    while (Date.now() < until) {
      // Block the event loop on purpose.
    }
    await sleep(400);

    expect(eventLoopLag().maxMs).toBeLessThan(50);
  });
});
