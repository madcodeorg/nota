type ProxyFetch = (
  url: string,
  init: RequestInit & { bypassCustomProtocolHandlers: boolean }
) => Promise<Response>;

export async function fetchProtocolResponse(
  request: Request,
  targetUrl: string,
  fetcher: ProxyFetch,
  bypassCustomProtocolHandlers: boolean
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
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            cleanup();
            reader.releaseLock();
            output.close();
          } else {
            output.enqueue(chunk.value);
          }
        } catch (error) {
          cleanup();
          controller.abort();
          output.error(error);
        }
      },
      async cancel(reason) {
        cleanup();
        // Electron net.fetch does not abort its ClientRequest when its body
        // is cancelled. Closing EventSource must also release the upstream
        // HTTP connection, otherwise six old streams block all backend calls.
        controller.abort(reason);
        await reader.cancel(reason).catch(() => {});
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
