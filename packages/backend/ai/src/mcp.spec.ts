import { describe, expect, test } from 'vitest';

import { isGatedMcpWriteTool } from './mcp';

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
