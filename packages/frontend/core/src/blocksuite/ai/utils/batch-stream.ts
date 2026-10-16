const MAX_DELAY_MS = 100;

/**
 * Collects streamed chunks and hands them to `apply` at most once per frame.
 * Chunks are kept separate (not concatenated) because a chunk may be a JSON
 * stream object that must be parsed on its own.
 */
export function createStreamBatcher(apply: (chunks: string[]) => void) {
  let pending: string[] = [];
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    frame = undefined;
    timer = undefined;
  };

  const flush = () => {
    cancel();
    if (!pending.length) return;
    const chunks = pending;
    pending = [];
    apply(chunks);
  };

  return {
    push(chunk: string) {
      pending.push(chunk);
      if (frame !== undefined || timer !== undefined) return;
      // requestAnimationFrame is paused in hidden tabs, so the timeout
      // guarantees updates still happen.
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(flush);
      }
      timer = setTimeout(
        flush,
        typeof requestAnimationFrame === 'function' ? MAX_DELAY_MS : 16
      );
    },
    flush,
  };
}
