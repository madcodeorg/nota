type ProxyFetch = (
  url: string,
  init: RequestInit & { bypassCustomProtocolHandlers: boolean }
) => Promise<Response>;

// How long an event stream may hold an unread chunk before the renderer is
// treated as gone. Live readers pull at once; backend streams send at least a
// heartbeat every 15 s, so a closed page is noticed within about 45 s.
export const STALLED_EVENT_STREAM_MS = 30_000;

export async function fetchProtocolResponse(
  request: Request,
  targetUrl: string,
  fetcher: ProxyFetch,
  bypassCustomProtocolHandlers: boolean,
  stalledStreamMs = STALLED_EVENT_STREAM_MS
) {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  const cleanup = () => request.signal.removeEventListener('abort', abort);
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();

  try {
    const response = await fetcher(
      targetUrl,
      Object.assign(new Request(request, { signal: controller.signal }), {
        bypassCustomProtocolHandlers,
      })
    );
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    const isEventStream = /text\/event-stream/i.test(
      response.headers.get('content-type') ?? ''
    );
    // Electron neither cancels a protocol response body nor aborts
    // request.signal when the page reloads or navigates away. A forgotten
    // event stream then keeps its HTTP connection, and after six of them every
    // backend call queues forever. A reader that leaves a chunk unread for
    // stalledStreamMs is gone, so release the upstream connection.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const release = (reason?: unknown) => {
      clearStallTimer();
      cleanup();
      // Electron net.fetch does not abort its ClientRequest when its body
      // is cancelled, so abort it explicitly.
      controller.abort(reason);
      reader.cancel(reason).catch(() => {});
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        clearStallTimer();
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            cleanup();
            reader.releaseLock();
            output.close();
          } else {
            output.enqueue(chunk.value);
            if (isEventStream) {
              stallTimer = setTimeout(() => {
                const reason = new Error('Event stream reader stalled');
                release(reason);
                output.error(reason);
              }, stalledStreamMs);
            }
          }
        } catch (error) {
          clearStallTimer();
          cleanup();
          controller.abort();
          output.error(error);
        }
      },
      async cancel(reason) {
        release(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    cleanup();
    controller.abort();
    throw error;
  }
}
