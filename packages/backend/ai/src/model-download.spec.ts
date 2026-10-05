import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config';
import {
  downloadModelFile,
  type LocalModelDownloadJob,
  prepareLocalModelSeed,
  queueModelDownload,
  runWithConcurrency,
  verifyLocalModelSeed,
} from './meetings';
import { localModelById, type LocalModelManifest } from './model-registry';

const originalWorkspaceRoot = process.env.NOTA_AI_WORKSPACE_ROOT;
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalWorkspaceRoot === undefined) {
    delete process.env.NOTA_AI_WORKSPACE_ROOT;
  } else {
    process.env.NOTA_AI_WORKSPACE_ROOT = originalWorkspaceRoot;
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { force: true, recursive: true }))
  );
});

describe('local model downloads', () => {
  it('bounds parallel file work while using every available slot', async () => {
    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5], 3, async item => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      completed.push(item);
      active -= 1;
    });

    expect(maxActive).toBe(3);
    expect(completed.sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('resumes a partial file with an HTTP range request', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-download-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const model = localModelById('qwen3.5-0.8b-onnx-q4f16');
    expect(model).toBeDefined();
    if (!model) {
      return;
    }
    const fileName = 'added_tokens.json';
    const expectedContent = 'hello world';
    const fixtureModel: LocalModelManifest = {
      ...model,
      fileSha256: {
        ...model.fileSha256,
        [fileName]: createHash('sha256').update(expectedContent).digest('hex'),
      },
    };
    const modelRoot = path.join(workspaceRoot, '.nota', 'models', model.id);
    await mkdir(modelRoot, { recursive: true });
    await writeFile(path.join(modelRoot, `${fileName}.download`), 'hello ');

    let requestedRange: string | undefined;
    const fixture = createServer((req, res) => {
      requestedRange = req.headers.range;
      res.statusCode = 206;
      res.setHeader('Content-Length', '5');
      res.setHeader('Content-Range', 'bytes 6-10/11');
      res.end('world');
    });
    fixture.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      fixture.once('listening', resolve);
      fixture.once('error', reject);
    });
    const address = fixture.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const job: LocalModelDownloadJob = {
      bytesDownloaded: 0,
      localPath: modelRoot,
      message: 'Downloading fixture.',
      modelId: model.id,
      progress: 0,
      requestedAt: new Date().toISOString(),
      status: 'downloading',
      totalBytes: 11,
      updatedAt: new Date().toISOString(),
    };
    let bytesDownloaded = 0;

    try {
      await downloadModelFile({
        config,
        fileName,
        job,
        model: fixtureModel,
        onBytes: async bytes => {
          bytesDownloaded += bytes;
        },
        size: 11,
        url: `http://127.0.0.1:${port}/model`,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        fixture.close(error => (error ? reject(error) : resolve()));
      });
    }

    expect(requestedRange).toBe('bytes=6-');
    expect(bytesDownloaded).toBe(11);
    await expect(
      readFile(path.join(modelRoot, fileName), 'utf8')
    ).resolves.toBe(expectedContent);
  });

  it('rejects a resumed response whose content range starts at the wrong byte', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-download-range-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const model = localModelById('qwen3.5-0.8b-onnx-q4f16');
    expect(model).toBeDefined();
    if (!model) return;

    const fileName = 'added_tokens.json';
    const modelRoot = path.join(workspaceRoot, '.nota', 'models', model.id);
    const partialPath = path.join(modelRoot, `${fileName}.download`);
    await mkdir(modelRoot, { recursive: true });
    await writeFile(partialPath, 'hello ');

    const fixture = createServer((_req, res) => {
      res.statusCode = 206;
      res.setHeader('Content-Length', '5');
      res.setHeader('Content-Range', 'bytes 5-9/11');
      res.end('world');
    });
    fixture.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      fixture.once('listening', resolve);
      fixture.once('error', reject);
    });
    const address = fixture.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const job: LocalModelDownloadJob = {
      bytesDownloaded: 0,
      localPath: modelRoot,
      message: 'Downloading fixture.',
      modelId: model.id,
      progress: 0,
      requestedAt: new Date().toISOString(),
      status: 'downloading',
      totalBytes: 11,
      updatedAt: new Date().toISOString(),
    };

    try {
      await expect(
        downloadModelFile({
          config,
          fileName,
          job,
          model,
          onBytes: async () => {},
          size: 11,
          url: `http://127.0.0.1:${port}/model`,
        })
      ).rejects.toThrow('expected byte 6');
    } finally {
      await new Promise<void>((resolve, reject) => {
        fixture.close(error => (error ? reject(error) : resolve()));
      });
    }

    await expect(readFile(partialPath, 'utf8')).resolves.toBe('hello ');
  });

  it('keeps a short response resumable instead of promoting it to a model file', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-download-short-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const model = localModelById('qwen3.5-0.8b-onnx-q4f16');
    expect(model).toBeDefined();
    if (!model) return;

    const fileName = 'added_tokens.json';
    const modelRoot = path.join(workspaceRoot, '.nota', 'models', model.id);
    const partialPath = path.join(modelRoot, `${fileName}.download`);
    const finalPath = path.join(modelRoot, fileName);
    const fixture = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Length', '5');
      res.end('short');
    });
    fixture.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      fixture.once('listening', resolve);
      fixture.once('error', reject);
    });
    const address = fixture.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const job: LocalModelDownloadJob = {
      bytesDownloaded: 0,
      localPath: modelRoot,
      message: 'Downloading fixture.',
      modelId: model.id,
      progress: 0,
      requestedAt: new Date().toISOString(),
      status: 'downloading',
      totalBytes: 11,
      updatedAt: new Date().toISOString(),
    };

    try {
      await expect(
        downloadModelFile({
          config,
          fileName,
          job,
          model,
          onBytes: async () => {},
          size: 11,
          url: `http://127.0.0.1:${port}/model`,
        })
      ).rejects.toThrow('expected 11 bytes, received 5');
    } finally {
      await new Promise<void>((resolve, reject) => {
        fixture.close(error => (error ? reject(error) : resolve()));
      });
    }

    await expect(readFile(partialPath, 'utf8')).resolves.toBe('short');
    await expect(readFile(finalPath, 'utf8')).rejects.toThrow();
  });

  it('removes a wrong-size final file before promoting its replacement', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-download-replace-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const model: LocalModelManifest = {
      downloadUrl: 'https://huggingface.co/nota/test-model',
      files: ['model.bin'],
      id: `test-download-replace-${Date.now()}`,
      languages: ['en-US'],
      license: 'test',
      minRamGb: 1,
      repoId: 'nota/test-model',
      revision: 'main',
      runtime: 'onnxruntime',
      sha256: '',
      sizeMb: 1,
      streaming: false,
      type: 'text',
    };
    const modelRoot = path.join(workspaceRoot, '.nota', 'models', model.id);
    const finalPath = path.join(modelRoot, 'model.bin');
    await mkdir(modelRoot, { recursive: true });
    await writeFile(finalPath, 'old and too long');
    const job: LocalModelDownloadJob = {
      bytesDownloaded: 0,
      localPath: modelRoot,
      message: 'Replacing fixture.',
      modelId: model.id,
      progress: 0,
      requestedAt: new Date().toISOString(),
      status: 'downloading',
      totalBytes: 3,
      updatedAt: new Date().toISOString(),
    };
    let finalFileWasRemoved = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      try {
        await readFile(finalPath);
      } catch {
        finalFileWasRemoved = true;
      }
      return new Response('new', {
        headers: { 'Content-Length': '3' },
        status: 200,
      });
    });

    await downloadModelFile({
      config,
      fileName: 'model.bin',
      job,
      model,
      onBytes: async () => {},
      size: 3,
      url: 'https://huggingface.co/nota/test-model/model.bin',
    });

    expect(finalFileWasRemoved).toBe(true);
    await expect(readFile(finalPath, 'utf8')).resolves.toBe('new');
  });

  it('coalesces concurrent requests for the same model into one download', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-download-lock-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const model: LocalModelManifest = {
      downloadUrl: 'https://huggingface.co/nota/test-model',
      files: ['model.bin'],
      id: `test-download-lock-${Date.now()}`,
      languages: ['en-US'],
      license: 'test',
      minRamGb: 1,
      repoId: 'nota/test-model',
      revision: 'main',
      runtime: 'onnxruntime',
      sha256: '',
      sizeMb: 1,
      streaming: false,
      type: 'text',
    };
    let headRequests = 0;
    let getRequests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'HEAD') {
        headRequests++;
        return new Response(null, {
          headers: { 'Content-Length': '5' },
          status: 200,
        });
      }
      getRequests++;
      return new Response('hello', {
        headers: { 'Content-Length': '5' },
        status: 200,
      });
    });

    const [first, second] = await Promise.all([
      queueModelDownload(config, model),
      queueModelDownload(config, model),
    ]);
    expect(first).toBe(second);

    const finalPath = path.join(
      workspaceRoot,
      '.nota',
      'models',
      model.id,
      'model.bin'
    );
    await vi.waitFor(
      async () => {
        await expect(readFile(finalPath, 'utf8')).resolves.toBe('hello');
      },
      { timeout: 2000 }
    );
    expect(headRequests).toBe(1);
    expect(getRequests).toBe(1);
  });

  it('requires a checksum for every file in a release seed', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-seed-unhashed-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const model: LocalModelManifest = {
      downloadUrl: 'https://huggingface.co/nota/test-model',
      files: ['model.bin'],
      id: `test-unhashed-seed-${Date.now()}`,
      languages: ['en-US'],
      license: 'test',
      minRamGb: 1,
      repoId: 'nota/test-model',
      revision: 'main',
      runtime: 'onnxruntime',
      sha256: '',
      sizeMb: 1,
      streaming: false,
      type: 'stt',
    };

    await expect(verifyLocalModelSeed(config, model)).rejects.toThrow(
      'without SHA-256 checksums for: model.bin'
    );
  });

  it('repairs a corrupt same-size seed before release packaging', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-seed-repair-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    const expectedContent = 'hello';
    const model: LocalModelManifest = {
      downloadUrl: 'https://huggingface.co/nota/test-model',
      files: ['model.bin'],
      fileSha256: {
        'model.bin': createHash('sha256').update(expectedContent).digest('hex'),
      },
      id: `test-seed-repair-${Date.now()}`,
      languages: ['en-US'],
      license: 'test',
      minRamGb: 1,
      repoId: 'nota/test-model',
      revision: 'main',
      runtime: 'onnxruntime',
      sha256: '',
      sizeMb: 1,
      streaming: false,
      type: 'stt',
    };
    const modelRoot = path.join(workspaceRoot, '.nota', 'models', model.id);
    await mkdir(modelRoot, { recursive: true });
    await writeFile(path.join(modelRoot, 'model.bin'), 'wrong');

    let getRequests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: { 'Content-Length': String(expectedContent.length) },
          status: 200,
        });
      }
      getRequests += 1;
      return new Response(expectedContent, {
        headers: { 'Content-Length': String(expectedContent.length) },
        status: 200,
      });
    });

    const seed = await prepareLocalModelSeed(config, model);

    expect(seed.bytes).toBe(expectedContent.length);
    expect(getRequests).toBe(1);
    await expect(
      readFile(path.join(modelRoot, 'model.bin'), 'utf8')
    ).resolves.toBe(expectedContent);
  });
});
