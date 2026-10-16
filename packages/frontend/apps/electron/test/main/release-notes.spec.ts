import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getReleaseNotes } from '@nota-tools/utils/release-notes';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../../..', import.meta.url));

describe('release notes from CHANGELOG.md', () => {
  const changelog = [
    '# Changelog',
    '## Unreleased',
    '- Work in progress',
    '## [1.2.0] - 2026-10-16',
    '- Faster search',
    '  - nested detail',
    '* Meeting summaries',
    '## 1.1.0',
    '- Old item',
  ].join('\n');

  it('reads top-level bullets for the version', () => {
    expect(getReleaseNotes(changelog, '1.2.0')).toEqual([
      'Faster search',
      'Meeting summaries',
    ]);
    expect(getReleaseNotes(changelog, '1.1.0')).toEqual(['Old item']);
  });

  it('falls back to Unreleased, else nothing', () => {
    expect(getReleaseNotes(changelog, '9.9.9')).toEqual(['Work in progress']);
    expect(getReleaseNotes('## 1.0.0\n- a', '2.0.0')).toEqual([]);
  });

  it('uses the same notes for the GitHub release body', () => {
    const workflow = readFileSync(
      path.join(repoRoot, '.github/workflows/release-desktop.yml'),
      'utf8'
    );
    expect(workflow).toContain(
      'node tools/utils/src/release-notes.ts "$RELEASE_VERSION" > "$RUNNER_TEMP/release-notes.md"'
    );
    expect(workflow).toContain(
      'body_path: ${{ runner.temp }}/release-notes.md'
    );
  });
});
