import { extMimeMap, getAssetName } from '@blocksuite/store';
import * as fflate from 'fflate';
import { FAILSAFE_SCHEMA, load as loadYaml } from 'js-yaml';

export class Zip {
  private compressed = new Uint8Array();

  private finalize?: () => void;

  private finalized = false;

  private readonly zip = new fflate.Zip((err, chunk, final) => {
    if (!err) {
      const temp = new Uint8Array(this.compressed.length + chunk.length);
      temp.set(this.compressed);
      temp.set(chunk, this.compressed.length);
      this.compressed = temp;
    }
    if (final) {
      this.finalized = true;
      this.finalize?.();
    }
  });

  async file(path: string, content: Blob | File | string) {
    const deflate = new fflate.ZipDeflate(path);
    this.zip.add(deflate);
    if (typeof content === 'string') {
      deflate.push(fflate.strToU8(content), true);
    } else {
      deflate.push(new Uint8Array(await content.arrayBuffer()), true);
    }
  }

  folder(folderPath: string) {
    return {
      folder: (folderPath2: string) => {
        return this.folder(`${folderPath}/${folderPath2}`);
      },
      file: async (name: string, blob: Blob) => {
        await this.file(`${folderPath}/${name}`, blob);
      },
      generate: async () => {
        return this.generate();
      },
    };
  }

  async generate() {
    this.zip.end();
    return new Promise<Blob>(resolve => {
      if (this.finalized) {
        resolve(new Blob([this.compressed], { type: 'application/zip' }));
      } else {
        this.finalize = () =>
          resolve(new Blob([this.compressed], { type: 'application/zip' }));
      }
    });
  }
}

export class Unzip {
  private unzipped?: ReturnType<typeof fflate.unzipSync>;

  async load(blob: Blob) {
    if (blob.size > 512 * 1024 * 1024)
      throw new Error('Archives are limited to 512 MB compressed.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const paths = new Set<string>();
    let expanded = 0;
    // First read directory metadata without expanding any entry. Reject the
    // whole archive before allocating an attacker-controlled expansion buffer.
    fflate.unzipSync(bytes, {
      filter: file => {
        const path = file.name.replace(/\\/g, '/');
        const segments = path.split('/');
        if (
          path.startsWith('/') ||
          /^[a-z]:/i.test(path) ||
          path.includes('\0') ||
          segments.includes('..') ||
          segments.some(segment =>
            ['__proto__', 'constructor', 'prototype'].includes(segment)
          )
        )
          throw new Error('The archive contains an unsafe file path.');
        if (paths.has(path))
          throw new Error('The archive contains duplicate file paths.');
        paths.add(path);
        expanded += file.originalSize;
        if (
          paths.size > 20000 ||
          file.originalSize > 512 * 1024 * 1024 ||
          expanded > 1024 * 1024 * 1024
        )
          throw new Error(
            'The archive exceeds the supported expansion limit (1 GB or 20,000 files).'
          );
        return false;
      },
    });
    this.unzipped = fflate.unzipSync(bytes);
  }

  *[Symbol.iterator]() {
    const keys = Object.keys(this.unzipped ?? {});
    let index = 0;
    while (keys.length) {
      const path = keys.shift()!;
      if (path.includes('__MACOSX') || path.includes('DS_Store')) {
        continue;
      }
      const lastSplitIndex = path.lastIndexOf('/');
      const fileName = path.substring(lastSplitIndex + 1);
      const fileExt =
        fileName.lastIndexOf('.') === -1 ? '' : fileName.split('.').at(-1);
      const mime = extMimeMap.get(fileExt ?? '');
      const content = new File(
        [new Uint8Array(this.unzipped![path]).buffer],
        fileName,
        mime ? { type: mime } : undefined
      ) as Blob;

      // fflate already decodes ZIP filenames. Re-decoding UTF-16 code units
      // as bytes corrupts valid Unicode paths and breaks manifest references.
      yield { path, content, index };
      index++;
    }
  }
}

export async function createAssetsArchive(
  assetsMap: Map<string, Blob>,
  assetsIds: string[]
) {
  const zip = new Zip();

  for (const [id, blob] of assetsMap) {
    if (!assetsIds.includes(id)) continue;
    const name = getAssetName(assetsMap, id);
    await zip.folder('assets').file(name, blob);
  }

  return zip;
}

export function download(blob: Blob, name: string) {
  const element = document.createElement('a');
  element.setAttribute('download', name);
  const fileURL = URL.createObjectURL(blob);
  element.setAttribute('href', fileURL);
  element.style.display = 'none';
  document.body.append(element);
  element.click();
  element.remove();
  URL.revokeObjectURL(fileURL);
}

const metaMatcher = /(?<=---)(.*?)(?=---)/ms;
const bodyMatcher = /---.*?---/s;
export const parseMatter = (contents: string) => {
  const matterMatch = contents.match(metaMatcher);
  if (!matterMatch || !matterMatch[0]) return null;
  const metadata = loadYaml(matterMatch[0], { schema: FAILSAFE_SCHEMA });
  if (!metadata || typeof metadata !== 'object') return null;
  const body = contents.replace(bodyMatcher, '');
  return { matter: matterMatch[0], body, metadata };
};
