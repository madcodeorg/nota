import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

// Items are written in pieces of about this many characters.
const WRITE_CHUNK_CHARS = 256 * 1024;

/**
 * Writes `head`, the JSON of every item separated by commas, then `tail`, as
 * one file that replaces `filePath` only once it is complete.
 *
 * The bytes are those of stringifying the whole object at once, but each item
 * is serialized and written separately. The event loop is free between pieces,
 * and the full file never exists as one string; a large history or index would
 * otherwise stall chat streaming and meeting audio for as long as it takes to
 * serialize. A failed write leaves the previous file and no temporary file.
 */
export async function writeJsonItemsFile(
  filePath: string,
  input: {
    head: string;
    items: Iterable<unknown>;
    mode?: number;
    tail: string;
  }
) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await open(temporaryPath, 'w', input.mode);
    try {
      let pending = input.head;
      let first = true;
      for (const item of input.items) {
        pending += (first ? '' : ',') + JSON.stringify(item);
        first = false;
        if (pending.length >= WRITE_CHUNK_CHARS) {
          await handle.write(pending);
          pending = '';
        }
      }
      await handle.write(pending + input.tail);
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
