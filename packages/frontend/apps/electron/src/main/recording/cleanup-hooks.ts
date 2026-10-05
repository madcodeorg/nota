type BeforeRecordingStateClear = () => void | Promise<void>;

const beforeRecordingStateClearRegistry: BeforeRecordingStateClear[] = [];

/**
 * Register work that needs the finalized raw archive and recording metadata.
 * Hooks run after capture/archive forwarding stops and before recording state
 * is cleared during feature teardown or app quit.
 */
export function beforeRecordingStateClear(fn: BeforeRecordingStateClear) {
  beforeRecordingStateClearRegistry.push(fn);
  return () => {
    const index = beforeRecordingStateClearRegistry.indexOf(fn);
    if (index >= 0) {
      beforeRecordingStateClearRegistry.splice(index, 1);
    }
  };
}

export async function runBeforeRecordingStateClear() {
  const errors: unknown[] = [];
  const hooks = beforeRecordingStateClearRegistry.slice();
  for (const fn of hooks) {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      'Failed to finish recording cleanup hooks.'
    );
  }
}
