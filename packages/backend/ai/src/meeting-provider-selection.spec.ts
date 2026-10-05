import { describe, expect, test } from 'vitest';

import { selectMeetingSttProvider } from './meetings.js';

type SelectionInput = Parameters<typeof selectMeetingSttProvider>[0];
type Provider = SelectionInput['providers'][number];

const modelIds: Record<Provider['id'], string | undefined> = {
  'cactus-whistle': 'cactus-whistle',
  'whisper-tiny-cpp': 'whisper-tiny-q5-cpp',
  'whisper-base-cpp': 'whisper-base-q5-cpp',
  'whisper-small-cpp': 'whisper-small-q5-cpp',
  'whisper-medium-cpp': 'whisper-medium-q5-cpp',
  'whisper-large-v3-cpp': 'whisper-large-v3-q5-cpp',
  'apple-speechanalyzer': undefined,
  'cohere-onnx': 'cohere-transcribe-03-2026-onnx',
  'distil-whisper-large-v3-5-onnx': 'distil-whisper-large-v3-5-onnx-q4',
  'moonshine-base-onnx': 'moonshine-base-onnx-q4',
  'nemotron-sherpa': 'sherpa-nemotron-3.5-streaming-560ms-int8',
  'parakeet-sherpa': 'sherpa-parakeet-tdt-0.6b-v3-int8',
  'whisper-tiny-en-onnx': 'whisper-tiny-en-onnx-q4',
};
const providerIds = Object.keys(modelIds) as Provider['id'][];
const heavyProviders: Provider['id'][] = [
  'cohere-onnx',
  'distil-whisper-large-v3-5-onnx',
];

function providers(availableIds: Provider['id'][] = []): Provider[] {
  return providerIds.map(id => {
    const available = availableIds.includes(id);
    const apple = id === 'apple-speechanalyzer';
    const streaming = apple || id === 'nemotron-sherpa';
    const reason = available ? null : `${id} needs setup.`;
    return {
      id,
      name: id,
      platform: apple ? ['macos', 'ios'] : ['macos', 'windows', 'linux'],
      local: true,
      streaming,
      downloadRequired: !apple,
      defaultForPlatform: false,
      available,
      canProduceTranscript: available,
      modelId: modelIds[id],
      notes: '',
      transcriptMode: available
        ? streaming
          ? 'native-streaming'
          : 'vad-chunk'
        : 'unavailable',
      unavailableReason: reason ?? undefined,
      readiness: {
        available,
        canStart: available,
        modelComplete: available,
        reason,
        runtimeAvailable: !apple || available,
        runtimeId: apple ? 'apple-speech' : 'sherpa-onnx',
        status: available
          ? 'available'
          : apple
            ? 'missing_runtime'
            : 'missing_model',
      },
    };
  });
}

function config(meetingSttProviderId = 'auto'): SelectionInput['config'] {
  return { meetingSttProviderId } as SelectionInput['config'];
}

describe.each([
  {
    platform: 'darwin',
    primary: 'cactus-whistle',
    secondary: 'nemotron-sherpa',
  },
  {
    platform: 'win32',
    primary: 'cactus-whistle',
    secondary: 'nemotron-sherpa',
  },
  {
    platform: 'linux',
    primary: 'cactus-whistle',
    secondary: 'nemotron-sherpa',
  },
] as const)(
  'meeting STT selection on $platform',
  ({ platform, primary, secondary }) => {
    test('rejects the retired legacy provider as an explicit selection', () => {
      expect(
        selectMeetingSttProvider({
          config: config(),
          platform,
          providers: providers(providerIds),
          requestedProviderId: 'nemotron-onnx',
        })
      ).toEqual({
        error: 'Unsupported STT provider: nemotron-onnx',
        provider: null,
        requestedProviderId: 'auto',
      });
    });

    test('keeps the native platform default ahead of installed fallbacks', () => {
      expect(
        selectMeetingSttProvider({
          config: config(),
          platform,
          providers: providers(providerIds),
        })
      ).toMatchObject({
        error: null,
        provider: { id: primary },
        requestedProviderId: 'auto',
      });
    });

    test('keeps the second native choice ahead of installed fallbacks', () => {
      expect(
        selectMeetingSttProvider({
          config: config(),
          platform,
          providers: providers(providerIds.filter(id => id !== primary)),
          requestedProviderId: 'auto',
        }).provider?.id
      ).toBe(secondary);
    });

    test('prefers installed multilingual Tiny over Moonshine and heavy fallbacks', () => {
      expect(
        selectMeetingSttProvider({
          config: config(),
          platform,
          providers: providers([
            ...heavyProviders,
            'moonshine-base-onnx',
            'whisper-tiny-en-onnx',
          ]),
          requestedProviderId: 'auto',
        }).provider?.id
      ).toBe('whisper-tiny-en-onnx');
    });

    test('prefers installed Moonshine over heavy fallbacks when Tiny is missing', () => {
      expect(
        selectMeetingSttProvider({
          config: config(),
          platform,
          providers: providers([...heavyProviders, 'moonshine-base-onnx']),
        }).provider?.id
      ).toBe('moonshine-base-onnx');
    });

    test('retains an available configured preference over the platform order', () => {
      expect(
        selectMeetingSttProvider({
          config: config('cohere-onnx'),
          platform,
          providers: providers(providerIds),
          requestedProviderId: 'auto',
        }).provider?.id
      ).toBe('cohere-onnx');
    });

    test('skips an unavailable configured preference without changing it', () => {
      const settings = config('cohere-onnx');
      expect(
        selectMeetingSttProvider({
          config: settings,
          platform,
          providers: providers(['whisper-tiny-en-onnx']),
          requestedProviderId: 'auto',
        }).provider?.id
      ).toBe('whisper-tiny-en-onnx');
      expect(settings.meetingSttProviderId).toBe('cohere-onnx');
    });

    test('refuses an unavailable explicit request even when Tiny is installed', () => {
      expect(
        selectMeetingSttProvider({
          config: config(),
          platform,
          providers: providers(['whisper-tiny-en-onnx']),
          requestedProviderId: 'cohere-onnx',
        })
      ).toEqual({
        error: 'cohere-onnx needs setup.',
        provider: null,
        requestedProviderId: 'cohere-onnx',
      });
    });

    test('honors an available explicit request over the configured preference', () => {
      expect(
        selectMeetingSttProvider({
          config: config(primary),
          platform,
          providers: providers(providerIds),
          requestedProviderId: 'cohere-onnx',
        })
      ).toMatchObject({
        error: null,
        provider: { id: 'cohere-onnx' },
        requestedProviderId: 'cohere-onnx',
      });
    });

    test.each(['auto', 'cohere-onnx'])(
      'recommends the platform default for first-time setup with %s configured',
      preference => {
        expect(
          selectMeetingSttProvider({
            config: config(preference),
            platform,
            providers: providers(),
          })
        ).toMatchObject({
          error: null,
          provider: {
            id: primary,
            available: false,
            readiness: { status: 'missing_model' },
          },
          requestedProviderId: 'auto',
        });
      }
    );
  }
);

describe('Apple Speech stays manual-only', () => {
  test.each(['auto', 'apple-speechanalyzer'])(
    'does not select available Apple Speech in Auto with %s configured',
    preference => {
      expect(
        selectMeetingSttProvider({
          config: config(preference),
          platform: 'darwin',
          providers: providers(['apple-speechanalyzer']),
          requestedProviderId: 'auto',
        })
      ).toMatchObject({
        error: null,
        provider: { id: 'cactus-whistle', available: false },
        requestedProviderId: 'auto',
      });
    }
  );

  test('selects available Apple Speech when explicitly requested', () => {
    expect(
      selectMeetingSttProvider({
        config: config(),
        platform: 'darwin',
        providers: providers(providerIds),
        requestedProviderId: 'apple-speechanalyzer',
      })
    ).toMatchObject({
      error: null,
      provider: { id: 'apple-speechanalyzer' },
      requestedProviderId: 'apple-speechanalyzer',
    });
  });
});
