import { describe, expect, test } from 'vitest';

import {
  initialWorkspaceCreationTarget,
  selectableWorkspaceServers,
} from './server-selector-options';

describe('workspace creation targets', () => {
  test('hides the unusable built-in cloud target in Electron', () => {
    const servers = [{ id: 'nota-cloud' }, { id: 'self-hosted-team' }];

    expect(selectableWorkspaceServers(servers, true)).toEqual([
      { id: 'self-hosted-team' },
    ]);
    expect(selectableWorkspaceServers(servers, false)).toEqual(servers);
  });

  test('coerces a legacy Nota Cloud request to a local-first target', () => {
    expect(
      initialWorkspaceCreationTarget('nota-cloud', {
        googleConnected: false,
        isElectron: true,
      })
    ).toBe('local');
    expect(
      initialWorkspaceCreationTarget('nota-cloud', {
        googleConnected: true,
        isElectron: true,
      })
    ).toBe('google-drive');
  });

  test('keeps explicit supported targets unchanged', () => {
    expect(
      initialWorkspaceCreationTarget('self-hosted-team', {
        googleConnected: false,
        isElectron: true,
      })
    ).toBe('self-hosted-team');
  });
});
