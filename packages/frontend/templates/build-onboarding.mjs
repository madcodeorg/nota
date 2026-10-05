import { readdir, readFile, writeFile } from 'node:fs/promises';

import JSZip from 'jszip';

const directory = new URL('./onboarding/', import.meta.url);
const zip = new JSZip();
for (const filename of (await readdir(directory)).sort()) {
  if (!filename.endsWith('.snapshot.json')) continue;
  zip.file(filename, await readFile(new URL(filename, directory)), {
    date: new Date('1980-01-01T00:00:00Z'),
  });
}
await writeFile(
  new URL('onboarding.zip', directory),
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
);
