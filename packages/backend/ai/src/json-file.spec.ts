import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeJsonItemsFile } from './json-file';

const roots: string[] = [];

async function createRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nota-json-file-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
  await Promise.all(
    roots.splice(0).map(root => rm(root, { force: true, recursive: true }))
  );
});

describe('writeJsonItemsFile', () => {
  it('writes the same bytes as stringifying the whole object, across chunks', async () => {
    const filePath = path.join(await createRoot(), 'nested', 'out.json');
    const items = Array.from({ length: 40 }, (_, index) => ({
      index,
      text: `quote " backslash \\ newline \n emoji 😀 中文 ${'x'.repeat(20_000)}`,
    }));

    await writeJsonItemsFile(filePath, {
      head: '{"items":[',
      items,
      tail: '],"version":1}',
    });

    const written = await readFile(filePath, 'utf8');
    expect(written.length).toBeGreaterThan(256 * 1024 * 2);
    expect(written).toBe(JSON.stringify({ items, version: 1 }));
  });

  it('writes an empty list', async () => {
    const filePath = path.join(await createRoot(), 'out.json');

    await writeJsonItemsFile(filePath, {
      head: '{"items":[',
      items: [],
      tail: '],"version":1}',
    });

    await expect(readFile(filePath, 'utf8')).resolves.toBe(
      '{"items":[],"version":1}'
    );
  });

  it('serializes items lazily, so a generator can be consumed while writing', async () => {
    const filePath = path.join(await createRoot(), 'out.json');
    const produced: number[] = [];

    await writeJsonItemsFile(filePath, {
      head: '[',
      items: (function* () {
        for (const value of [1, 2, 3]) {
          produced.push(value);
          yield value;
        }
      })(),
      tail: ']',
    });

    expect(produced).toEqual([1, 2, 3]);
    await expect(readFile(filePath, 'utf8')).resolves.toBe('[1,2,3]');
  });

  it('applies the requested file mode', async () => {
    const filePath = path.join(await createRoot(), 'private.json');

    await writeJsonItemsFile(filePath, {
      head: '[',
      items: [1],
      mode: 0o600,
      tail: ']',
    });

    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps the previous file and leaves no temporary file when the item cannot be serialized', async () => {
    const root = await createRoot();
    const filePath = path.join(root, 'out.json');
    await writeFile(filePath, '{"previous":true}');

    await expect(
      writeJsonItemsFile(filePath, {
        head: '[',
        items: [{ value: 1n }],
        tail: ']',
      })
    ).rejects.toThrow();

    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"previous":true}');
    await expect(readdir(root)).resolves.toEqual(['out.json']);
  });

  it('keeps the previous file and leaves no temporary file when the final rename fails', async () => {
    const root = await createRoot();
    const filePath = path.join(root, 'out.json');
    await writeFile(filePath, '{"previous":true}');
    vi.resetModules();
    vi.doMock('node:fs/promises', async importOriginal => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      rename: vi.fn().mockRejectedValue(new Error('disk full')),
    }));
    const { writeJsonItemsFile: failing } = await import('./json-file');

    await expect(
      failing(filePath, { head: '[', items: [1], tail: ']' })
    ).rejects.toThrow('disk full');

    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"previous":true}');
    await expect(readdir(root)).resolves.toEqual(['out.json']);
  });
});
