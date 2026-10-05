import { describe, expect, test } from 'vitest';

import { parseMacOSMemoryPressure } from './device-memory';

describe('parseMacOSMemoryPressure', () => {
  test('converts the macOS free percentage into usable bytes', () => {
    expect(
      parseMacOSMemoryPressure(
        'System-wide memory free percentage: 46%\n',
        24 * 1024 ** 3
      )
    ).toBe(Math.round(24 * 1024 ** 3 * 0.46));
  });

  test('accepts decimal percentages', () => {
    expect(
      parseMacOSMemoryPressure(
        'System-wide memory free percentage: 12.5%',
        16 * 1024 ** 3
      )
    ).toBe(2 * 1024 ** 3);
  });

  test('rejects missing and invalid percentages', () => {
    expect(parseMacOSMemoryPressure('no reading', 16 * 1024 ** 3)).toBeNull();
    expect(
      parseMacOSMemoryPressure(
        'System-wide memory free percentage: 101%',
        16 * 1024 ** 3
      )
    ).toBeNull();
  });
});
