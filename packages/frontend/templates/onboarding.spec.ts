import { readFile } from 'node:fs/promises';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

describe('first workspace content', () => {
  it('ships the auditable Nota starter pages without upstream links or media', async () => {
    const zip = await JSZip.loadAsync(
      await readFile(new URL('./onboarding/onboarding.zip', import.meta.url))
    );
    const filenames = Object.keys(zip.files).sort();
    expect(filenames).toEqual([
      'Getting Started -F-TNy6Tt3t.snapshot.json',
      'How to use folder and Tags-kV_wO0ALWs.snapshot.json',
    ]);

    for (const filename of filenames) {
      const bundled = await zip.file(filename)!.async('string');
      const source = await readFile(
        new URL(`./onboarding/${filename}`, import.meta.url),
        'utf8'
      );
      expect(bundled).toBe(source);
      expect(bundled).not.toMatch(
        /affine\.(pro|run|vip)|toeverything\/AFFiNE|discord\.|meta:(created|updated)By/
      );
      const snapshot = JSON.parse(bundled);
      expect(snapshot.type).toBe('page');
      expect(snapshot.blocks.flavour).toBe('affine:page');
      expect(
        snapshot.blocks.children.map(
          (block: { flavour: string }) => block.flavour
        )
      ).toEqual(['affine:surface', 'affine:note']);
    }
  });
});
