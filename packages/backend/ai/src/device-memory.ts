import { execFileSync } from 'node:child_process';
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

/**
 * `os.freemem()` only reports immediately unused pages on macOS. It excludes
 * reclaimable inactive/compressed memory and can therefore make a healthy Mac
 * look as if it has only a few megabytes available. `memory_pressure -Q`
 * exposes the operating system's usable-memory estimate, which is the value
 * Nota needs when deciding whether a local model can load safely.
 */
export function availableMemoryBytes() {
  const fallback = os.freemem();
  if (process.platform !== 'darwin') {
    return fallback;
  }

  const checkedAt = Date.now();
  if (
    cachedMacOSMemory &&
    checkedAt - cachedMacOSMemory.checkedAt < MACOS_MEMORY_CACHE_MS
  ) {
    return Math.max(fallback, cachedMacOSMemory.availableBytes);
  }

  try {
    const output = execFileSync('/usr/bin/memory_pressure', ['-Q'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: 1_000,
    });
    const availableBytes = parseMacOSMemoryPressure(output, os.totalmem());
    if (availableBytes !== null) {
      cachedMacOSMemory = { availableBytes, checkedAt };
      return Math.max(fallback, availableBytes);
    }
  } catch {
    // Fall back to Node's conservative value when the macOS utility is absent
    // or unavailable in a restricted runtime.
  }

  return fallback;
}
