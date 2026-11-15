import { describe, expect, it } from 'vitest';

import { centeredBounds } from '../../src/main/windows-manager/bounds';

describe('Linux onboarding window bounds', () => {
  it('centers the card-sized window in the work area', () => {
    expect(
      centeredBounds(
        { x: 0, y: 32, width: 1920, height: 1048 },
        { width: 948, height: 618 }
      )
    ).toEqual({ x: 486, y: 247, width: 948, height: 618 });
  });

  it('never exceeds a small work area', () => {
    expect(
      centeredBounds(
        { x: 100, y: 0, width: 800, height: 600 },
        { width: 948, height: 618 }
      )
    ).toEqual({ x: 100, y: 0, width: 800, height: 600 });
  });
});
