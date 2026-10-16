import { expect, test } from 'vitest';

import { isADCOnlyProvider, SDK_PROVIDER_PRESETS } from './provider-presets';

test.each([
  'google-vertex-anthropic',
  'google-vertex-maas',
  'google-vertex-xai',
] as const)(
  '%s uses project/location device credentials without API key input',
  provider => {
    expect(isADCOnlyProvider(provider)).toBe(true);
    expect(SDK_PROVIDER_PRESETS[provider].fields).toEqual([
      'project',
      'location',
    ]);
    expect(SDK_PROVIDER_PRESETS[provider].baseUrl).toBe('');
    expect(SDK_PROVIDER_PRESETS[provider].model).toBe('');
  }
);

test('Vertex Gemini keeps express API key support and AWS token inputs remain available', () => {
  expect(isADCOnlyProvider('google-vertex')).toBe(false);
  expect(isADCOnlyProvider('amazon-bedrock')).toBe(false);
  expect(isADCOnlyProvider('anthropic-aws')).toBe(false);
});
