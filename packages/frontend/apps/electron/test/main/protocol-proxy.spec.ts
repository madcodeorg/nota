import { describe, expect, it, vi } from 'vitest';

import { fetchProtocolResponse } from '../../src/main/protocol-proxy';

describe('custom protocol backend proxy', () => {
  it('releases every upstream stream when a transcript subscription closes', async () => {
    let active = 0;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      active++;
      init.signal!.addEventListener('abort', () => active--, { once: true });
      // Match Electron: body cancellation alone does not abort the request.
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: transcript\n\n')
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    for (let index = 0; index < 12; index++) {
      const response = await fetchProtocolResponse(
        new Request('https://nota.local/events'),
        'http://127.0.0.1/events',
        fetcher,
        true
      );
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();
      expect(active).toBe(0);
    }
  });

  it('preserves authenticated uploads and manual redirect handling', async () => {
    const request = new Request('https://nota.local/settings', {
      method: 'POST',
      headers: { 'x-nota-backend-token': 'test-token' },
      body: '{"provider":"whisper"}',
      redirect: 'manual',
    });
    let posted = '';
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1/settings');
      expect(new Headers(init.headers).get('x-nota-backend-token')).toBe(
        'test-token'
      );
      expect(init.redirect).toBe('manual');
      expect(init.method).toBe('POST');
      posted = await new Response(init.body).text();
      return new Response('saved', {
        status: 201,
        headers: { 'x-result': 'saved' },
      });
    });
    const response = await fetchProtocolResponse(
      request,
      'http://127.0.0.1/settings',
      fetcher,
      true
    );
    expect(posted).toBe('{"provider":"whisper"}');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-result')).toBe('saved');
    expect(await response.text()).toBe('saved');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      bypassCustomProtocolHandlers: true,
    });
  });

  it('aborts pending fetches when the originating request aborts', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener(
            'abort',
            () => reject(init.signal!.reason),
            { once: true }
          );
        })
    );
    const result = fetchProtocolResponse(
      new Request('https://nota.local/settings', { signal: controller.signal }),
      'http://127.0.0.1/settings',
      fetcher,
      true
    );
    const assertion = expect(result).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await assertion;
  });

  it('handles empty and failed responses without keeping an abort listener', async () => {
    const request = new Request('https://nota.local/settings');
    const remove = vi.spyOn(request.signal, 'removeEventListener');
    const response = await fetchProtocolResponse(
      request,
      'http://127.0.0.1/settings',
      async () => new Response(null, { status: 204 }),
      false
    );
    expect(response.status).toBe(204);
    expect(remove).toHaveBeenCalled();
    await expect(
      fetchProtocolResponse(
        request,
        'http://127.0.0.1/settings',
        async () => {
          throw new Error('offline');
        },
        true
      )
    ).rejects.toThrow('offline');
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
