import { monitorEventLoopDelay } from 'node:perf_hooks';

// Chat streaming, search, store writes and meeting audio intake share one event
// loop. Blocking it delays all of them, so track how long it stalls.
const RESOLUTION_MS = 10;
const DEFAULT_WINDOW_MS = 10_000;
const KEPT_WINDOWS = 6;
const WARN_AFTER_MS = 250;

type LagWindow = { maxMs: number; p99Ms: number };

let histogram: ReturnType<typeof monitorEventLoopDelay> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let windows: LagWindow[] = [];

// The timer itself fires every RESOLUTION_MS, so subtract that baseline.
function lagMs(nanoseconds: number) {
  return Math.max(0, Math.round(nanoseconds / 1e6 - RESOLUTION_MS));
}

export function startEventLoopMonitor(options: { windowMs?: number } = {}) {
  if (timer) return;
  const monitor = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram = monitor;
  monitor.enable();
  timer = setInterval(() => {
    const window = {
      maxMs: lagMs(monitor.max),
      p99Ms: lagMs(monitor.percentile(99)),
    };
    monitor.reset();
    windows = [...windows, window].slice(-KEPT_WINDOWS);
    if (window.maxMs >= WARN_AFTER_MS) {
      console.warn(
        `[event-loop] blocked for up to ${window.maxMs}ms (p99 ${window.p99Ms}ms)`
      );
    }
  }, options.windowMs ?? DEFAULT_WINDOW_MS);
  timer.unref();
}

export function stopEventLoopMonitor() {
  if (timer) clearInterval(timer);
  histogram?.disable();
  timer = undefined;
  histogram = undefined;
  windows = [];
}

/** Worst recent stalls, over the last few completed windows. */
export function eventLoopLag() {
  return {
    maxMs: Math.max(0, ...windows.map(window => window.maxMs)),
    p99Ms: Math.max(0, ...windows.map(window => window.p99Ms)),
  };
}
