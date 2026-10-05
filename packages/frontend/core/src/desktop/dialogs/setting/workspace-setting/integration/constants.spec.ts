// @vitest-environment happy-dom

import { isServerBackedWorkspaceFlavour } from '@nota/core/modules/workspace';
import { describe, expect, test } from 'vitest';

import { getAllowedIntegrationList } from './constants';

const integrationIdsFor = (flavour: string) =>
  getAllowedIntegrationList(isServerBackedWorkspaceFlavour(flavour)).map(
    integration => integration.id
  );

describe('workspace integration availability', () => {
  test.each(['local', 'google-drive'])(
    'does not offer server-token MCP for %s workspaces',
    flavour => {
      expect(integrationIdsFor(flavour)).toEqual(['readwise', 'calendar']);
    }
  );

  test('keeps the server MCP panel for server-backed workspaces', () => {
    expect(integrationIdsFor('nota-cloud')).toEqual([
      'readwise',
      'calendar',
      'mcp-server',
    ]);
  });
});
