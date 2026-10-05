export type SystemAudioAccessResult = {
  available: boolean;
  checkedAt: number;
  reason: string | null;
  status: 'granted' | 'unknown';
};

type SystemAudioCaptureRuntime = {
  probeSystemAudioAccess?: () => void;
};

const PROBE_CACHE_MS = 1000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Core Audio has no public permission preflight for process taps. The only
 * authoritative check is creating and starting a tap, then stopping it.
 */
export class SystemAudioAccessProbe {
  private lastResult: SystemAudioAccessResult | null = null;

  constructor(
    private readonly loadRuntime: () => SystemAudioCaptureRuntime,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Return the last functional probe result without creating a Core Audio tap.
   * A passive permission refresh must never be able to trigger the macOS
   * System Audio Recording prompt.
   */
  peek(): SystemAudioAccessResult | null {
    return this.lastResult;
  }

  check(force = false): SystemAudioAccessResult {
    const checkedAt = this.now();
    if (
      !force &&
      this.lastResult &&
      checkedAt - this.lastResult.checkedAt < PROBE_CACHE_MS
    ) {
      return this.lastResult;
    }

    try {
      const runtime = this.loadRuntime();
      if (typeof runtime.probeSystemAudioAccess !== 'function') {
        throw new Error(
          'This native runtime does not support system-only audio permission checks. Update the native binding before retrying; microphone capture was not started.'
        );
      }
      runtime.probeSystemAudioAccess();
      this.lastResult = {
        available: true,
        checkedAt,
        reason: null,
        status: 'granted',
      };
    } catch (error) {
      this.lastResult = {
        available: false,
        checkedAt,
        reason: errorMessage(error),
        status: 'unknown',
      };
    }

    return this.lastResult;
  }

  markGranted() {
    this.lastResult = {
      available: true,
      checkedAt: this.now(),
      reason: null,
      status: 'granted',
    };
  }
}
