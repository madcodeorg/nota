import { execFile } from 'node:child_process';
import os from 'node:os';

const MACOS_MEMORY_CACHE_MS = 5_000;

let cachedMacOSMemory:
  | {
      availableBytes: number;
      checkedAt: number;
    }
  | undefined;

export function parseMacOSMemoryPressure(
  output: string,
  totalMemoryBytes: number
) {
  const match = output.match(
    /System-wide memory free percentage:\s*([0-9]+(?:\.[0-9]+)?)%/i
  );
  if (!match) {
    return null;
  }

  const percentage = Number(match[1]);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return null;
  }

  return Math.round(totalMemoryBytes * (percentage / 100));
}

function readMemoryPressure() {
  return new Promise<string>((resolve, reject) => {
    execFile(
      '/usr/bin/memory_pressure',
      ['-Q'],
      { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 1_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });
}

let refreshing: Promise<void> | undefined;

/**
 * Re-reads the macOS usable-memory estimate without blocking the event loop.
 * The backend calls this once at startup so the first request already has a
 * reading; `availableMemoryBytes` triggers it again when the reading is stale.
 */
export function refreshAvailableMemory() {
  if (process.platform !== 'darwin') return Promise.resolve();
  refreshing ??= readMemoryPressure()
    .then(output => parseMacOSMemoryPressure(output, os.totalmem()))
    .catch(() => null)
    .then(availableBytes => {
      // A failed read is cached as 0 so a missing or restricted utility is
      // retried at the normal interval instead of on every call.
      cachedMacOSMemory = {
        availableBytes: availableBytes ?? 0,
        checkedAt: Date.now(),
      };
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

/**
 * `os.freemem()` only reports immediately unused pages on macOS. It excludes
 * reclaimable inactive/compressed memory and can therefore make a healthy Mac
 * look as if it has only a few megabytes available. `memory_pressure -Q`
 * exposes the operating system's usable-memory estimate, which is the value
 * Nota needs when deciding whether a local model can load safely.
 *
 * This is called on request paths, so it never waits for that utility: it
 * returns the last reading (or Node's conservative value before the first one)
 * and refreshes in the background.
 */
export function availableMemoryBytes() {
  const fallback = os.freemem();
  if (process.platform !== 'darwin') {
    return fallback;
  }

  if (
    !cachedMacOSMemory ||
    Date.now() - cachedMacOSMemory.checkedAt >= MACOS_MEMORY_CACHE_MS
  ) {
    refreshAvailableMemory().catch(() => {});
  }
  return Math.max(fallback, cachedMacOSMemory?.availableBytes ?? 0);
}
