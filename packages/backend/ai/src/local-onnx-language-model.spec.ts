import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import {
  InterruptableStoppingCriteria,
  PreTrainedTokenizer,
} from '@huggingface/transformers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiBackendConfig } from './config';
import { setLocalOnnxTransformersLoaderForTesting } from './local-onnx';
import { createLocalOnnxLanguageModel } from './local-onnx-language-model';

const MODEL_ID = 'qwen3.5-0.8b-onnx-q4f16';
const SECOND_MODEL_ID = 'gemma-4-e2b-it-onnx-q4f16';
const config = {
  workspaceRoot: '/tmp/nota-local-onnx-abort-test',
} as AiBackendConfig;

class FakeTextStreamer {
  constructor(
    _tokenizer: unknown,
    private readonly options: Record<string, unknown>
  ) {}

  emit(delta: string) {
    const callback = this.options.callback_function;
    if (typeof callback === 'function') {
      callback(delta);
    }
  }
}

function installGenerator(
  generate: (
    messages: unknown,
    options: Record<string, unknown>
  ) => Promise<unknown>,
  model?: {
    sessions?: Record<
      string,
      | {
          inputNames?: readonly string[];
          run: (
            feeds: Record<string, unknown>,
            ...options: unknown[]
          ) => Promise<unknown>;
        }
      | undefined
    >;
  },
  tokenizer: object = {}
) {
  const generator = Object.assign(
    (messages: unknown, options: Record<string, unknown>) =>
      generate(messages, options),
    { model, tokenizer }
  );
  const pipeline = vi.fn(async () => generator);
  setLocalOnnxTransformersLoaderForTesting(async () => ({
    env: {
      allowLocalModels: false,
      allowRemoteModels: true,
      localModelPath: '',
    },
    InterruptableStoppingCriteria,
    pipeline,
    TextStreamer: FakeTextStreamer,
  }));
  return pipeline;
}

function installDisposableGenerators(
  generate: (
    modelId: string,
    messages: unknown,
    options: Record<string, unknown>
  ) => Promise<unknown>
) {
  const disposals = new Map<string, Array<() => Promise<void>>>();
  const pipeline = vi.fn(async (_task: string, modelId: string) => {
    const dispose = vi.fn(async () => {});
    const modelDisposals = disposals.get(modelId) ?? [];
    modelDisposals.push(dispose);
    disposals.set(modelId, modelDisposals);
    return Object.assign(
      (messages: unknown, options: Record<string, unknown>) =>
        generate(modelId, messages, options),
      { dispose, tokenizer: {} }
    );
  });
  setLocalOnnxTransformersLoaderForTesting(async () => ({
    env: {
      allowLocalModels: false,
      allowRemoteModels: true,
      localModelPath: '',
    },
    InterruptableStoppingCriteria,
    pipeline,
    TextStreamer: FakeTextStreamer,
  }));
  return { disposals, pipeline };
}

function callOptions(
  abortSignal: AbortSignal,
  responseFormat?: LanguageModelV3CallOptions['responseFormat']
): LanguageModelV3CallOptions {
  return {
    abortSignal,
    prompt: [
      {
        content: [{ text: 'Keep generating.', type: 'text' }],
        role: 'user',
      },
    ],
    responseFormat,
  } as LanguageModelV3CallOptions;
}

async function collectStream(
  stream: ReadableStream<LanguageModelV3StreamPart>
) {
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value);
  }
}

describe('local ONNX response mode', () => {
  it('streams only the final answer from the always-thinking Liquid 2.6B model', async () => {
    installGenerator(
      async (_messages, options) => {
        expect(options.max_new_tokens).toBe(4096);
        const streamer = options.streamer as FakeTextStreamer;
        streamer.emit('Private reasoning.</thi');
        streamer.emit('nk>');
        streamer.emit('The answer.');
        streamer.emit('<|im_end|>');
        return [{ generated_text: 'Private reasoning.The answer.' }];
      },
      undefined,
      { all_special_tokens: ['<|im_end|>'] }
    );
    const model = createLocalOnnxLanguageModel({
      config,
      modelId: 'lfm2.5-2.6b-onnx-q4f16',
    });
    const parts = await collectStream(
      (await model.doStream(callOptions(new AbortController().signal))).stream
    );
    expect(
      parts
        .filter(part => part.type === 'text-delta')
        .map(part => part.delta)
        .join('')
    ).toBe('The answer.');
  });

  it('reports a reasoning budget exhaustion instead of returning reasoning as an answer', async () => {
    installGenerator(async (_messages, options) => {
      (options.streamer as FakeTextStreamer).emit('Still reasoning.');
      return [{ generated_text: 'Still reasoning.' }];
    });
    const model = createLocalOnnxLanguageModel({
      config,
      modelId: 'lfm2.5-2.6b-onnx-q4f16',
    });
    await expect(
      model.doGenerate(callOptions(new AbortController().signal))
    ).rejects.toThrow('before producing a final answer');
  });
  it('renders Liquid 230M assistant-mask annotations through the JS tokenizer', async () => {
    const tokenizer = new PreTrainedTokenizer(
      {
        model: { type: 'WordLevel', vocab: { '[UNK]': 0 }, unk_token: '[UNK]' },
        decoder: { type: 'WordPiece', prefix: '##', cleanup: true },
        pre_tokenizer: { type: 'Whitespace' },
        post_processor: null,
        normalizer: null,
        added_tokens: [],
      },
      {
        unk_token: '[UNK]',
        chat_template:
          'user:{%- generation -%}{{ messages[0].content }}{%- endgeneration -%}:assistant',
      }
    );
    installGenerator(
      async () => [{ generated_text: 'Answer.' }],
      undefined,
      tokenizer
    );
    const model = createLocalOnnxLanguageModel({
      config,
      modelId: 'lfm2.5-230m-onnx-q4',
    });
    await model.doGenerate(callOptions(new AbortController().signal));
    expect(
      tokenizer.apply_chat_template(
        [{ role: 'user', content: 'Keep generating.' }],
        { tokenize: false }
      )
    ).toBe('user:Keep generating.:assistant');
  });
  it.each([MODEL_ID, SECOND_MODEL_ID, 'smollm3-3b-onnx-q4f16'])(
    'disables template thinking for %s in generated and streamed answers',
    async modelId => {
      const generate = vi.fn(async () => [{ generated_text: 'Answer.' }]);
      installGenerator(generate);
      const model = createLocalOnnxLanguageModel({ config, modelId });
      const options = callOptions(new AbortController().signal);

      await model.doGenerate(options);
      const result = await model.doStream(options);
      await collectStream(result.stream);

      expect(generate).toHaveBeenCalledTimes(2);
      for (const call of generate.mock.calls as unknown[][]) {
        expect(call[1]).toMatchObject({
          do_sample: false,
          tokenizer_encode_kwargs: { enable_thinking: false },
        });
      }
    }
  );
});

describe('local ONNX generation memory use', () => {
  it.each([
    'gemma-4-e2b-it-onnx-q4f16',
    'gemma-4-e4b-it-onnx-q4f16',
    'qwen3.5-2b-onnx-q4f16',
    'lfm2.5-350m-onnx-q4f16',
  ])('limits %s generation to the final prompt logit', async modelId => {
    const logitsToKeep = { data: new BigInt64Array([0n]) };
    const valuesAtRun: unknown[] = [];
    const run = vi.fn(async (feeds: Record<string, unknown>) => {
      const tensor = feeds.num_logits_to_keep as {
        data: BigInt64Array;
      };
      valuesAtRun.push(tensor.data[0]);
      return {};
    });
    const session = {
      inputNames: ['num_logits_to_keep'],
      run,
    };
    const pipeline = installGenerator(
      async () => {
        await session.run({ num_logits_to_keep: logitsToKeep });
        return [{ generated_text: 'Nota local AI OK' }];
      },
      { sessions: { decoder_model_merged: session } }
    );
    const model = createLocalOnnxLanguageModel({
      config,
      modelId,
    });

    const result = await model.doGenerate(
      callOptions(new AbortController().signal)
    );

    expect(run).toHaveBeenCalledOnce();
    expect(valuesAtRun).toEqual([1n]);
    expect(logitsToKeep.data[0]).toBe(1n);
    expect(pipeline).toHaveBeenCalledWith(
      'text-generation',
      modelId,
      modelId.startsWith('gemma-4')
        ? expect.objectContaining({
            session_options: { enableCpuMemArena: false },
          })
        : expect.anything()
    );
    expect(result.content).toEqual([
      { text: 'Nota local AI OK', type: 'text' },
    ]);
  });

  it('leaves non-Gemma sessions and allocator settings unchanged', async () => {
    const run = vi.fn(async (_feeds: Record<string, unknown>) => ({}));
    const session = { inputNames: ['input_ids'], run };
    const pipeline = installGenerator(
      async () => [{ generated_text: 'Qwen OK' }],
      { sessions: { model: session } }
    );
    const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });

    await model.doGenerate(callOptions(new AbortController().signal));

    expect(session.run).toBe(run);
    expect(pipeline).toHaveBeenCalledWith(
      'text-generation',
      MODEL_ID,
      expect.not.objectContaining({ session_options: expect.anything() })
    );
  });

  it('disposes the previous idle pipeline when another model is selected', async () => {
    const { disposals, pipeline } = installDisposableGenerators(
      async modelId => [{ generated_text: `${modelId} OK` }]
    );
    const signal = new AbortController().signal;

    await createLocalOnnxLanguageModel({
      config,
      modelId: MODEL_ID,
    }).doGenerate(callOptions(signal));
    await createLocalOnnxLanguageModel({
      config,
      modelId: SECOND_MODEL_ID,
    }).doGenerate(callOptions(signal));

    await vi.waitFor(() =>
      expect(disposals.get(MODEL_ID)?.[0]).toHaveBeenCalledOnce()
    );
    expect(disposals.get(SECOND_MODEL_ID)?.[0]).not.toHaveBeenCalled();
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it('defers eviction until an active generation releases its pipeline', async () => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const { disposals } = installDisposableGenerators(async modelId => {
      if (modelId === MODEL_ID) {
        markStarted();
        await released;
      }
      return [{ generated_text: `${modelId} OK` }];
    });
    const signal = new AbortController().signal;
    const firstGeneration = createLocalOnnxLanguageModel({
      config,
      modelId: MODEL_ID,
    }).doGenerate(callOptions(signal));

    await started;
    await createLocalOnnxLanguageModel({
      config,
      modelId: SECOND_MODEL_ID,
    }).doGenerate(callOptions(signal));

    expect(disposals.get(MODEL_ID)?.[0]).not.toHaveBeenCalled();
    release();
    await firstGeneration;
    await vi.waitFor(() =>
      expect(disposals.get(MODEL_ID)?.[0]).toHaveBeenCalledOnce()
    );
    expect(disposals.get(SECOND_MODEL_ID)?.[0]).not.toHaveBeenCalled();
  });
});

describe('local ONNX model context budgets', () => {
  const modelId = 'lfm2.5-1.2b-instruct-onnx-q4f16';

  it.each(['generate', 'stream'] as const)(
    'reserves only the remaining context for %s output',
    async mode => {
      const generate = vi.fn(async () => [{ generated_text: 'Answer.' }]);
      const applyChatTemplate = vi.fn(() => ({
        input_ids: { dims: [1, 32760] },
      }));
      installGenerator(generate, undefined, {
        apply_chat_template: applyChatTemplate,
      });
      const model = createLocalOnnxLanguageModel({ config, modelId });
      const options = {
        ...callOptions(new AbortController().signal),
        maxOutputTokens: 12000,
      };
      if (mode === 'stream') {
        await collectStream((await model.doStream(options)).stream);
      } else {
        await model.doGenerate(options);
      }
      expect(generate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ max_new_tokens: 8 })
      );
      expect(applyChatTemplate).toHaveBeenCalledWith(expect.anything(), {
        add_generation_prompt: true,
        enable_thinking: false,
        return_dict: true,
      });
    }
  );

  it('rejects a prompt that leaves no output space before generation', async () => {
    const generate = vi.fn(async () => [{ generated_text: 'Answer.' }]);
    installGenerator(generate, undefined, {
      apply_chat_template: () => ({ input_ids: { dims: [1, 32768] } }),
    });
    const model = createLocalOnnxLanguageModel({ config, modelId });
    await expect(
      model.doGenerate(callOptions(new AbortController().signal))
    ).rejects.toThrow('token context');
    expect(generate).not.toHaveBeenCalled();
  });

  it('preserves the 12000-token summary budget when it fits', async () => {
    const generate = vi.fn(async () => [{ generated_text: 'Answer.' }]);
    installGenerator(generate, undefined, {
      apply_chat_template: () => ({ input_ids: { dims: [1, 2048] } }),
    });
    const model = createLocalOnnxLanguageModel({ config, modelId });
    await model.doGenerate({
      ...callOptions(new AbortController().signal),
      maxOutputTokens: 12000,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ max_new_tokens: 12000 })
    );
  });
});

afterEach(() => {
  setLocalOnnxTransformersLoaderForTesting(null);
});

describe('local ONNX provider cancellation', () => {
  it('rejects an already-aborted generation before loading the pipeline', async () => {
    const pipeline = installGenerator(vi.fn());
    const controller = new AbortController();
    controller.abort();
    const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });

    await expect(
      model.doGenerate(callOptions(controller.signal))
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('interrupts the installed stopping criterion and removes its listener', async () => {
    let criteria: InterruptableStoppingCriteria | undefined;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    installGenerator(async (_messages, options) => {
      criteria = options.stopping_criteria as InterruptableStoppingCriteria;
      markStarted();
      await released;
      return [{ generated_text: 'This completion must not persist.' }];
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });
    const generation = model.doGenerate(callOptions(controller.signal));

    await started;
    controller.abort();
    expect(criteria).toBeInstanceOf(InterruptableStoppingCriteria);
    expect(criteria?.interrupted).toBe(true);
    release();

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('emits no post-abort delta or finish from the streaming provider', async () => {
    let criteria: InterruptableStoppingCriteria | undefined;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    installGenerator(async (_messages, options) => {
      criteria = options.stopping_criteria as InterruptableStoppingCriteria;
      const streamer = options.streamer as FakeTextStreamer;
      streamer.emit('Before abort');
      markStarted();
      await released;
      streamer.emit('After abort');
      return [{ generated_text: 'After abort' }];
    });
    const controller = new AbortController();
    const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });
    const result = await model.doStream(callOptions(controller.signal));
    const partsPromise = collectStream(result.stream);

    await started;
    controller.abort();
    expect(criteria?.interrupted).toBe(true);
    release();
    const parts = await partsPromise;

    expect(
      parts.filter(part => part.type === 'text-delta').map(part => part.delta)
    ).toEqual(['Before abort']);
    expect(parts.map(part => part.type)).not.toContain('text-end');
    expect(parts.map(part => part.type)).not.toContain('finish');
    expect(parts.find(part => part.type === 'error')).toMatchObject({
      error: { name: 'AbortError' },
      type: 'error',
    });
  });

  it('does not emit JSON text or finish after generation is aborted', async () => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    installGenerator(async () => {
      markStarted();
      await released;
      return [{ generated_text: '{"answer":"too late"}' }];
    });
    const controller = new AbortController();
    const model = createLocalOnnxLanguageModel({ config, modelId: MODEL_ID });
    const result = await model.doStream(
      callOptions(controller.signal, { type: 'json' })
    );
    const partsPromise = collectStream(result.stream);

    await started;
    controller.abort();
    release();
    const parts = await partsPromise;

    expect(parts.map(part => part.type)).not.toContain('text-delta');
    expect(parts.map(part => part.type)).not.toContain('text-end');
    expect(parts.map(part => part.type)).not.toContain('finish');
    expect(parts.find(part => part.type === 'error')).toMatchObject({
      error: { name: 'AbortError' },
      type: 'error',
    });
  });
});
