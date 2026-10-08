import { afterEach, describe, expect, test, vi } from 'vitest';

import { driveQueryValue, GoogleDriveConnection } from './connection';

const tokens = {
  accountId: 'owner',
  accessToken: 'token',
  expiresAt: Date.now() + 3600000,
};
const connections: GoogleDriveConnection[] = [];
async function connect() {
  const connection = new GoogleDriveConnection({ accountId: 'owner', tokens });
  connections.push(connection);
  connection.connect();
  await connection.waitForConnected();
  return connection;
}
afterEach(() => {
  connections.splice(0).forEach(connection => connection.disconnect(true));
  vi.unstubAllGlobals();
});

describe('Drive connection safety', () => {
  test('paginates through an empty intermediate page and rejects repeated tokens', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/about')) return Response.json({ user: {} });
      const page = new URL(url).searchParams.get('pageToken');
      if (!page)
        return Response.json({ files: [{ id: '1' }], nextPageToken: 'empty' });
      if (page === 'empty')
        return Response.json({ files: [], nextPageToken: 'last' });
      return Response.json({ files: [{ id: '2' }] });
    });
    vi.stubGlobal('fetch', fetch);
    const connection = await connect();
    expect(await connection.searchFiles('trashed = false')).toEqual([
      { id: '1' },
      { id: '2' },
    ]);
    fetch.mockImplementation(async (url: string) =>
      url.includes('/about')
        ? Response.json({ user: {} })
        : Response.json({ nextPageToken: 'same' })
    );
    await expect(connection.searchFiles('trashed = false')).rejects.toThrow(
      'repeated page token'
    );
  });

  test('null disconnect and switching accounts cannot reuse old or renderer-local tokens', async () => {
    const fetch = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetch);
    const connection = await connect();
    fetch.mockClear();
    connection.setTokenSnapshot(null);
    await expect(connection.searchFiles('trashed = false')).rejects.toThrow(
      'workspace owner account'
    );
    connection.setTokenSnapshot({
      ...tokens,
      accountId: 'other-account',
      accessToken: 'other-token',
    });
    await expect(connection.searchFiles('trashed = false')).rejects.toThrow(
      'workspace owner account'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('abort an in-flight owner upload on logout, and reject stale results', async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/about')) return Response.json({});
        started();
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          )
        );
      })
    );
    const connection = await connect();
    const pending = connection.driveFetch(
      'https://www.googleapis.com/upload/drive/v3/files',
      { method: 'POST' }
    );
    await ready;
    connection.setTokenSnapshot(null);
    await expect(pending).rejects.toThrow('aborted');
  });

  test('ten simultaneous rate limits retry without retaining occupied request slots', async () => {
    const attempts = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/about')) return Response.json({});
        const previous = attempts.get(url) ?? 0;
        attempts.set(url, previous + 1);
        return previous
          ? Response.json({})
          : new Response(null, {
              status: 429,
              headers: { 'Retry-After': '0' },
            });
      })
    );
    const connection = await connect();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        connection.driveFetch(
          `https://www.googleapis.com/drive/v3/files?id=${i}`
        )
      )
    );
    expect(results.every(result => result.ok)).toBe(true);
    expect([...attempts.values()]).toEqual(Array.from({ length: 10 }, () => 2));
  });

  test('retries an indeterminate upload with the same generated file ID and verifies the 409 result', async () => {
    let uploads = 0;
    const identities: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/about')) return Response.json({});
        if (url.includes('/generateIds'))
          return Response.json({ ids: ['stable-id'] });
        if (init?.method === 'POST') {
          const body = await (init.body as Blob).text();
          const match = /"id":"([^"]+)"/.exec(body);
          identities.push(match![1]);
          return new Response(null, {
            status: ++uploads === 1 ? 503 : 409,
            headers: { 'Retry-After': '0' },
          });
        }
        return Response.json({ id: 'stable-id', name: 'immutable' });
      })
    );
    const connection = await connect();
    expect(
      await connection.createFile('immutable', new Uint8Array([1]))
    ).toEqual({ id: 'stable-id', name: 'immutable' });
    expect(identities).toEqual(['stable-id', 'stable-id']);
  });

  test('401 requests use the shared session refresh signal instead of worker-owned refresh credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/about')
          ? Response.json({})
          : new Response(null, { status: 401 })
      )
    );
    const connection = await connect();
    const refresh = vi.fn();
    connection.onAuthRequired(refresh);
    expect(
      (await connection.driveFetch('https://www.googleapis.com/drive/v3/files'))
        .status
    ).toBe(401);
    expect(refresh).toHaveBeenCalledOnce();
    expect(connection.status).toBe('error');
  });

  test('escapes workspace names containing Drive query syntax', () => {
    expect(driveQueryValue("a'b\\c")).toBe("a\\'b\\\\c");
  });
});
