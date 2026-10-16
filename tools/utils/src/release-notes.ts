import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHANGELOG = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../CHANGELOG.md'
);

/**
 * Top-level bullets from the CHANGELOG.md section for `version`. Falls back to
 * `## Unreleased` so a release tagged before the section was renamed still
 * ships its notes.
 */
export function getReleaseNotes(changelog: string, version: string): string[] {
  const sections = changelog.split(/^## +/m).slice(1);
  const heading = (section: string) => section.split('\n', 1)[0].trim();
  const section =
    sections.find(s => /^\[?v?([^\]\s]+)/.exec(heading(s))?.[1] === version) ??
    sections.find(s => /^\[?unreleased\b/i.test(heading(s)));
  if (!section) return [];
  return section
    .split('\n')
    .slice(1)
    .flatMap(line => {
      const match = /^[-*]\s+(.*\S)\s*$/.exec(line);
      return match ? [match[1]] : [];
    });
}

export function readReleaseNotes(version: string): string[] {
  try {
    return getReleaseNotes(readFileSync(CHANGELOG, 'utf8'), version);
  } catch {
    return [];
  }
}

// `node tools/utils/src/release-notes.ts 0.1.4` prints the GitHub release body.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const notes = readReleaseNotes(process.argv[2] ?? '');
  if (notes.length) console.log(notes.map(note => `- ${note}`).join('\n'));
}
