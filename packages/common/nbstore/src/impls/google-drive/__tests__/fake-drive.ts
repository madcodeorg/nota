import type { DriveChange, DriveFile } from '../connection';

/** In-memory Drive appDataFolder used by the Drive storage tests. */
export class FakeDrive {
  files = new Map<string, { file: DriveFile; content: Uint8Array }>();
  log: DriveChange[] = [];
  sequence = 0;
  supportsChanges = true;
  loseNextUpload = false;
  requests: Array<{ url: string; method: string }> = [];
  private readonly sessions = new Map<
    string,
    { metadata: DriveFile; chunks: Uint8Array[] }
  >();

  private newFile(metadata: DriveFile, content: Uint8Array): DriveFile {
    return {
      ...metadata,
      modifiedTime: new Date(
        Date.UTC(2026, 9, 5, 12) + this.sequence * 1000
      ).toISOString(),
      size: String(content.length),
    };
  }

  private store(file: DriveFile, content: Uint8Array) {
    this.files.set(file.id, { file, content });
    this.log.push({ fileId: file.id, file });
  }

  remove(id: string) {
    this.files.delete(id);
    this.log.push({ fileId: id, removed: true });
  }

  downloads(id?: string) {
    return this.requests.filter(
      request =>
        request.url.includes('alt=media') && (!id || request.url.includes(id))
    ).length;
  }

  fetch = async (urlValue: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(urlValue));
    const method = init?.method ?? 'GET';
    this.requests.push({ url: url.toString(), method });
    if (url.pathname.endsWith('/about'))
      return Response.json({
        user: { permissionId: 'owner' },
        storageQuota: { usage: '1000', limit: '5000' },
      });
    if (url.pathname.endsWith('/generateIds'))
      return Response.json({ ids: [`file-${++this.sequence}`] });
    if (url.pathname.endsWith('/changes/startPageToken'))
      return this.supportsChanges
        ? Response.json({ startPageToken: String(this.log.length) })
        : new Response(null, { status: 403 });
    if (url.pathname === '/drive/v3/changes') {
      const start = Number(url.searchParams.get('pageToken'));
      return Response.json({
        changes: this.log.slice(start),
        newStartPageToken: String(this.log.length),
      });
    }
    if (
      url.hostname === 'www.googleapis.com' &&
      url.pathname === '/drive/v3/files'
    ) {
      const q = url.searchParams.get('q') ?? '';
      const clauses = [...q.matchAll(/name (contains|=) '((?:\\.|[^'])*)'/g)];
      const files = [...this.files.values()]
        .map(record => record.file)
        .filter(file =>
          clauses.every(([, op, raw]) => {
            const name = raw.replace(/\\(.)/g, '$1');
            return op === '=' ? file.name === name : file.name.includes(name);
          })
        );
      const page = Number(url.searchParams.get('pageToken') ?? 0);
      return Response.json({
        files: files.slice(page, page + 2),
        nextPageToken: page + 2 < files.length ? String(page + 2) : undefined,
      });
    }
    if (
      url.searchParams.get('uploadType') === 'resumable' &&
      method === 'POST'
    ) {
      const metadata = JSON.parse(String(init!.body)) as DriveFile;
      if (this.files.has(metadata.id))
        return new Response(null, { status: 409 });
      const id = `session-${this.sessions.size + 1}`;
      this.sessions.set(id, { metadata, chunks: [] });
      return new Response(null, {
        status: 200,
        headers: {
          Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}`,
        },
      });
    }
    const uploadId = url.searchParams.get('upload_id');
    if (uploadId && method === 'PUT') {
      const session = this.sessions.get(uploadId)!;
      session.chunks.push(
        new Uint8Array(await (init!.body as Blob).arrayBuffer())
      );
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(
        new Headers(init!.headers).get('Content-Range') ?? ''
      )!;
      const [end, total] = [Number(range[2]), Number(range[3])];
      if (end + 1 < total)
        return new Response(null, {
          status: 308,
          headers: { Range: `bytes=0-${end}` },
        });
      const content = new Uint8Array(total);
      let offset = 0;
      for (const chunk of session.chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
      const file = this.newFile(session.metadata, content);
      this.store(file, content);
      return Response.json(file);
    }
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      const body = new Uint8Array(await (init!.body as Blob).arrayBuffer());
      const text = new TextDecoder().decode(body);
      const headerEnd = text.indexOf('\r\n\r\n') + 4;
      const jsonEnd = text.indexOf('\r\n--', headerEnd);
      const metadata = JSON.parse(text.slice(headerEnd, jsonEnd)) as DriveFile;
      if (this.files.has(metadata.id))
        return new Response(null, { status: 409 });
      const dataStart = text.indexOf('\r\n\r\n', jsonEnd) + 4;
      const boundary = text.slice(0, text.indexOf('\r\n'));
      const tail = new TextEncoder().encode(`\r\n${boundary}--`);
      const content = body.slice(
        new TextEncoder().encode(text.slice(0, dataStart)).length,
        body.length - tail.length
      );
      const file = this.newFile(metadata, content);
      this.store(file, content);
      if (this.loseNextUpload) {
        this.loseNextUpload = false;
        throw new Error('Response lost after server accepted upload');
      }
      return Response.json(file);
    }
    const id = url.pathname.split('/').at(-1)!;
    const record = this.files.get(id);
    if (!record) return new Response(null, { status: 404 });
    if (method === 'DELETE') {
      this.remove(id);
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') {
      const { properties } = JSON.parse(String(init!.body)) as {
        properties: Record<string, string | null>;
      };
      const next = { ...record.file.properties };
      for (const [key, value] of Object.entries(properties)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      const file = { ...record.file, properties: next };
      this.store(file, record.content);
      return Response.json(file);
    }
    return url.searchParams.get('alt') === 'media'
      ? new Response(record.content.slice().buffer)
      : Response.json(record.file);
  };
}
