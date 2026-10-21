import { homedir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { expandHomePath, isGatedMcpWriteTool } from './mcp';

describe('expandHomePath', () => {
  test('expands a leading ~ only', () => {
    expect(expandHomePath('~')).toBe(homedir());
    expect(expandHomePath('~/Documents')).toBe(
      path.join(homedir(), 'Documents')
    );
    expect(expandHomePath('/tmp/~/x')).toBe('/tmp/~/x');
    expect(expandHomePath('~other')).toBe('~other');
  });
});

describe('MCP tool safety annotations', () => {
  test('lets destructiveHint win when a server publishes conflicting hints', () => {
    expect(
      isGatedMcpWriteTool('inspect_note', {
        annotations: {
          destructiveHint: true,
          readOnlyHint: true,
        },
      })
    ).toBe(true);
  });

  test('uses an unambiguous readOnlyHint before the name heuristic', () => {
    expect(
      isGatedMcpWriteTool('update_cache_preview', {
        annotations: {
          destructiveHint: false,
          readOnlyHint: true,
        },
      })
    ).toBe(false);
  });

  test('gates explicitly non-read-only and heuristic write tools', () => {
    expect(
      isGatedMcpWriteTool('inspect_note', {
        annotations: { readOnlyHint: false },
      })
    ).toBe(true);
    expect(isGatedMcpWriteTool('delete_note', {})).toBe(true);
  });
});
