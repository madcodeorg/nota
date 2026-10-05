import { describe, expect, test } from 'vitest';

import { MeetingSettingsSchema } from '../../src/main/shared-state-schema';

describe('MeetingSettingsSchema', () => {
  test('prompts for scheduled meetings by default without auto-recording', () => {
    expect(MeetingSettingsSchema.parse({}).recordingMode).toBe('prompt');
  });

  test('preserves an explicit choice to disable scheduled meeting prompts', () => {
    expect(
      MeetingSettingsSchema.parse({ recordingMode: 'none' }).recordingMode
    ).toBe('none');
  });
});
