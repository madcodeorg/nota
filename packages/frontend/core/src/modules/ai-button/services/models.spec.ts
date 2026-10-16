import { describe, expect, test } from 'vitest';

import {
  groupAIModelsByProvider,
  mergeAIModelCatalog,
  migrateAIModelId,
  monitorLocalModelDownload,
  readAIModelCatalogMetadata,
  resolveAIModelId,
  supportsAIModelImageAttachments,
} from './models';

describe('migrateAIModelId', () => {
  test('keeps a currently available qualified id', () => {
    expect(
      migrateAIModelId('openai:gpt-5-mini', [
        'local:gemma-4-e2b-it-onnx-q4f16',
        'openai:gpt-5-mini',
      ])
    ).toBe('openai:gpt-5-mini');
  });

  test('migrates an unqualified id only when its suffix is unique', () => {
    expect(
      migrateAIModelId('gpt-oss:20b', [
        'local:gpt-oss:20b',
        'openai:gpt-5-mini',
      ])
    ).toBe('local:gpt-oss:20b');

    expect(
      migrateAIModelId('shared-model', [
        'local:shared-model',
        'custom:shared-model',
      ])
    ).toBeNull();
  });

  test.each([
    'chatgpt',
    'alibaba',
    'baseten',
    'cerebras',
    'cohere',
    'deepinfra',
    'fireworks',
    'huggingface',
    'minimax',
    'moonshotai',
    'togetherai',
    'zai',
    'ai-gateway',
    'open-responses',
    'azure',
    'amazon-bedrock',
    'google-vertex',
    'google-vertex-anthropic',
    'google-vertex-maas',
    'google-vertex-xai',
    'anthropic-aws',
  ])('does not migrate a missing %s model to another provider', provider => {
    expect(
      migrateAIModelId(`${provider}:shared`, [`custom:${provider}:shared`])
    ).toBeNull();
    expect(migrateAIModelId(`${provider}:shared`, [`${provider}:shared`])).toBe(
      `${provider}:shared`
    );
  });

  test('does not silently move a missing qualified provider selection', () => {
    expect(
      migrateAIModelId('openai:gpt-5-mini', ['local:gpt-5-mini'])
    ).toBeNull();
  });
});

describe('supportsAIModelImageAttachments', () => {
  test('treats curated local ONNX models as text-only', () => {
    expect(
      supportsAIModelImageAttachments('local:gemma-4-e2b-it-onnx-q4f16')
    ).toBe(false);
    expect(supportsAIModelImageAttachments('local:qwen3:8b')).toBe(true);
    expect(supportsAIModelImageAttachments('openai:gpt-5-mini')).toBe(true);
  });

  test('prefers a backend-advertised attachment capability', () => {
    expect(
      supportsAIModelImageAttachments('custom:opaque-multimodal', false)
    ).toBe(false);
    expect(
      supportsAIModelImageAttachments('local:opaque-vision-model', true)
    ).toBe(true);
  });
});

describe('AI model catalog metadata', () => {
  test('uses advertised reasoning metadata and removes a failed ONNX probe', () => {
    const metadata = readAIModelCatalogMetadata({
      models: {
        optionalModels: [
          {
            id: 'local:gemma-4-e2b-it-onnx-q4f16',
            readiness: 'unverified',
            reasoningLevels: ['none'],
            selectable: true,
            supportsImageAttachments: false,
          },
          {
            id: 'custom:opaque-reasoning-model',
            readiness: 'ready',
            reasoningLevels: ['none', 'low', 'high'],
            selectable: true,
            supportsImageAttachments: true,
          },
        ],
      },
      meetings: {
        localModels: [
          {
            downloadStatus: 'downloaded',
            id: 'gemma-4-e2b-it-onnx-q4f16',
            runtimeProbe: {
              canLoad: false,
              message: 'ONNX Runtime failed to initialize this graph.',
              runtimeAvailable: true,
              status: 'failed',
            },
            type: 'text',
          },
        ],
      },
    });

    expect(metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:gemma-4-e2b-it-onnx-q4f16',
          readiness: 'unavailable',
          readinessMessage: 'ONNX Runtime failed to initialize this graph.',
          selectable: false,
        }),
      ])
    );

    const models = mergeAIModelCatalog(
      [
        {
          id: 'local:gemma-4-e2b-it-onnx-q4f16',
          name: 'Local gemma-4-e2b-it-onnx-q4f16',
        },
        {
          id: 'custom:opaque-reasoning-model',
          name: 'Custom opaque-reasoning-model',
        },
      ],
      'local:gemma-4-e2b-it-onnx-q4f16',
      metadata
    );

    expect(models).toEqual([
      expect.objectContaining({
        id: 'custom:opaque-reasoning-model',
        isDefault: true,
        reasoningLevels: ['none', 'low', 'high'],
        selectable: true,
      }),
    ]);
  });

  test('sends the shown fallback model when the backend has no default', () => {
    const models = mergeAIModelCatalog(
      [
        { id: 'chatgpt:gpt-5.4', name: 'ChatGPT gpt-5.4' },
        { id: 'openai:gpt-5-mini', name: 'OpenAI gpt-5-mini' },
      ],
      ''
    );

    expect(resolveAIModelId(models, undefined)).toBe('chatgpt:gpt-5.4');
    expect(resolveAIModelId(models, 'local:missing')).toBe('chatgpt:gpt-5.4');
    expect(resolveAIModelId(models, 'openai:gpt-5-mini')).toBe(
      'openai:gpt-5-mini'
    );
    expect(resolveAIModelId([], undefined)).toBeUndefined();
  });

  test('groups models by provider in catalog order', () => {
    const models = mergeAIModelCatalog(
      [
        { id: 'chatgpt:gpt-6-sol', name: 'ChatGPT gpt-6-sol' },
        { id: 'openai:gpt-5-mini', name: 'OpenAI gpt-5-mini' },
        { id: 'chatgpt:gpt-6-luna', name: 'ChatGPT gpt-6-luna' },
      ],
      ''
    );

    expect(
      groupAIModelsByProvider(models).map(group => ({
        provider: group.provider,
        ids: group.models.map(model => model.id),
      }))
    ).toEqual([
      { provider: 'ChatGPT', ids: ['chatgpt:gpt-6-sol', 'chatgpt:gpt-6-luna'] },
      { provider: 'OpenAI', ids: ['openai:gpt-5-mini'] },
    ]);
  });

  test('keeps older GraphQL-only catalogs selectable', () => {
    expect(
      mergeAIModelCatalog(
        [{ id: 'openai:gpt-5-mini', name: 'OpenAI gpt-5-mini' }],
        'openai:gpt-5-mini'
      )
    ).toEqual([
      expect.objectContaining({
        id: 'openai:gpt-5-mini',
        isDefault: true,
        selectable: true,
      }),
    ]);
  });

  test('keeps failed GraphQL catalog models out of selectors when settings fail', () => {
    expect(
      mergeAIModelCatalog(
        [
          {
            id: 'local:qwen3-0.6b-onnx-q4f16',
            name: 'Local qwen3-0.6b-onnx-q4f16',
            readiness: 'unavailable',
            readinessMessage: 'ONNX Runtime failed to load this graph.',
            reasoningLevels: ['none'],
            selectable: false,
            supportsImageAttachments: false,
          },
          {
            id: 'custom:reasoning-model',
            name: 'Custom reasoning-model',
            readiness: 'ready',
            readinessMessage: null,
            reasoningLevels: ['none', 'medium', 'high'],
            selectable: true,
            supportsImageAttachments: true,
          },
        ],
        'local:qwen3-0.6b-onnx-q4f16',
        []
      )
    ).toEqual([
      expect.objectContaining({
        category: 'Custom',
        id: 'custom:reasoning-model',
        isDefault: true,
        readiness: 'ready',
        readinessMessage: null,
        reasoningLevels: ['none', 'medium', 'high'],
        selectable: true,
        supportsImageAttachments: true,
      }),
    ]);
  });

  test('prefers current settings metadata over a stale GraphQL catalog', () => {
    expect(
      mergeAIModelCatalog(
        [
          {
            id: 'local:gemma-4-e2b-it-onnx-q4f16',
            name: 'Local gemma-4-e2b-it-onnx-q4f16',
            readiness: 'unavailable',
            readinessMessage: 'Stale failed probe.',
            reasoningLevels: ['none'],
            selectable: false,
            supportsImageAttachments: false,
          },
        ],
        'local:gemma-4-e2b-it-onnx-q4f16',
        [
          {
            id: 'local:gemma-4-e2b-it-onnx-q4f16',
            readiness: 'ready',
            readinessMessage: null,
            reasoningLevels: ['none', 'low'],
            selectable: true,
            supportsImageAttachments: true,
          },
        ]
      )
    ).toEqual([
      expect.objectContaining({
        readiness: 'ready',
        readinessMessage: null,
        reasoningLevels: ['none', 'low'],
        selectable: true,
        supportsImageAttachments: true,
      }),
    ]);
  });
});

describe('monitorLocalModelDownload', () => {
  test('survives a transient failure and refreshes after download completes', async () => {
    const statuses = ['throw', 'downloading', 'downloaded'];
    let refreshCount = 0;
    const fetcher = async () => {
      const status = statuses.shift();
      if (status === 'throw') throw new Error('connection reset');
      return {
        ok: true,
        json: async () => ({ download: { downloadStatus: status } }),
      };
    };

    await monitorLocalModelDownload({
      fetcher,
      modelId: 'gemma-4-e2b-it-onnx-q4f16',
      refreshModels: async () => {
        refreshCount += 1;
      },
      signal: new AbortController().signal,
      wait: async () => {},
    });

    expect(statuses).toHaveLength(0);
    expect(refreshCount).toBe(1);
  });
});
