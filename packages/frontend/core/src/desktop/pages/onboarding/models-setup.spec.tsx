// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { NotaModelsSetup } from './models-setup';

const chatId = 'qwen3.5-2b-onnx-q4f16';
const smallChatId = 'qwen3.5-0.8b-onnx-q4f16';
const speechModelId = 'whisper-base-q5-cpp';
const baseModel = {
  runtime: 'onnx',
  sizeMb: 1200,
  minRamGb: 4,
  deviceFit: 'fits',
  releaseState: 'ready',
  downloadStatus: 'downloaded',
};
const readyProbe = {
  status: 'available',
  canLoad: true,
  runtimeAvailable: true,
  message: 'Model loaded.',
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

let settings: {
  provider: string;
  localModel: string;
  meetings: {
    sttProviderId: string;
    sttModelId: string;
    sttLanguage: string;
  };
};
let models: Record<string, unknown>[];
let providers: Record<string, unknown>[];
let runtime: Record<string, unknown>;
let post: (url: string, init?: RequestInit) => ReturnType<typeof response>;
let fetchMock: ReturnType<typeof vi.fn>;

function requests(method = 'GET', endpoint?: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init?.method ?? 'GET') === method && (!endpoint || url === endpoint)
  );
}

async function ready(onContinue = vi.fn(), onSkip = vi.fn()) {
  const view = render(
    <NotaModelsSetup onContinue={onContinue} onSkip={onSkip} />
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Local chat model')).toHaveProperty(
      'disabled',
      false
    )
  );
  return { view, onContinue, onSkip };
}

describe('onboarding local chat and transcription model setup', () => {
  beforeEach(() => {
    settings = {
      provider: 'local',
      localModel: chatId,
      meetings: {
        sttProviderId: 'auto',
        sttModelId: '',
        sttLanguage: 'fr',
      },
    };
    models = [
      { ...baseModel, id: chatId, type: 'text', runtimeProbe: readyProbe },
      {
        ...baseModel,
        id: smallChatId,
        type: 'text',
        downloadStatus: 'not_started',
      },
      {
        ...baseModel,
        id: speechModelId,
        type: 'stt',
        languages: ['en', 'fr'],
        languageDetection: 'selectable',
      },
    ];
    providers = [
      {
        id: 'whisper-base-cpp',
        name: 'Whisper Base Q5',
        modelId: speechModelId,
        available: true,
        canProduceTranscript: true,
        defaultForPlatform: true,
        readiness: { status: 'available' },
      },
      {
        id: 'moonshine-base-onnx',
        name: 'Moonshine Base',
        modelId: 'moonshine-model',
        available: false,
        canProduceTranscript: false,
        readiness: { status: 'missing_model' },
      },
    ];
    runtime = {
      resolvedProvider: providers[0],
      transcriptAvailable: true,
    };
    post = () => response({ ok: true });
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return post(url, init);
      if (url === '/api/ai/settings') return response(settings);
      if (url === '/v1/local/models')
        return response({ models, device: { availableDiskGb: 30 } });
      if (url === '/v1/stt/runtime') return response({ ...runtime, providers });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('mount reads model information and never downloads, probes or saves', async () => {
    await ready();
    expect(requests().map(([url]) => url)).toEqual([
      '/api/ai/settings',
      '/v1/local/models',
      '/v1/stt/runtime',
    ]);
    expect(requests('POST')).toHaveLength(0);
    expect(
      screen.getAllByText('1,200 MB download · Minimum 4 GB RAM')
    ).toHaveLength(2);
    expect(screen.getByLabelText('Transcription model')).toHaveProperty(
      'value',
      'auto'
    );
  });

  test('preserves a hosted provider when no local chat was explicitly chosen', async () => {
    settings.provider = 'anthropic';
    const { onContinue } = await ready();
    expect(screen.getByLabelText('Local chat model')).toHaveProperty(
      'value',
      ''
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(requests('POST')).toHaveLength(0);
  });

  test('explicit local chat selection saves only the local text fields', async () => {
    settings.provider = 'openai';
    const { onContinue } = await ready();
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: chatId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(JSON.parse(requests('POST', '/api/ai/settings')[0][1].body)).toEqual(
      {
        defaultProvider: 'local',
        defaultModel: chatId,
        localModel: chatId,
      }
    );
  });

  test('successful chat save updates the renderer selection before continuing', async () => {
    settings.provider = 'anthropic';
    const onContinue = vi.fn();
    let resolveSelection: (() => void) | undefined;
    const onChatSelected = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveSelection = resolve;
        })
    );
    render(
      <NotaModelsSetup
        onContinue={onContinue}
        onChatSelected={onChatSelected}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Local chat model')).toHaveProperty(
        'disabled',
        false
      )
    );
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: chatId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(onChatSelected).toHaveBeenCalledWith(chatId));
    expect(requests('POST', '/api/ai/settings')).toHaveLength(1);
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => resolveSelection?.());
    expect(onContinue).toHaveBeenCalledOnce();
  });

  test.each(['download', 'probe'] as const)(
    'a successful current-chat %s refreshes renderer readiness before unchanged continue',
    async action => {
      if (action === 'download') {
        models[0] = {
          ...models[0],
          downloadStatus: 'not_started',
          runtimeProbe: undefined,
        };
      }
      const onContinue = vi.fn();
      const selection = deferred<void>();
      const onChatSelected = vi.fn(() => selection.promise);
      render(
        <NotaModelsSetup
          onContinue={onContinue}
          onChatSelected={onChatSelected}
        />
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Local chat model')).toHaveProperty(
          'disabled',
          false
        )
      );
      const actionResult = deferred<ReturnType<typeof response>>();
      fetchMock.mockReturnValueOnce(actionResult.promise);
      fireEvent.click(
        screen.getByRole('button', {
          name: `${action === 'download' ? 'Download' : 'Check'} Qwen3.5 2B`,
        })
      );
      expect(onChatSelected).not.toHaveBeenCalled();
      models[0] = {
        ...models[0],
        downloadStatus: 'downloaded',
        runtimeProbe: readyProbe,
      };
      await act(async () =>
        actionResult.resolve(
          action === 'download'
            ? response({ download: { status: 'downloaded' } }, 409)
            : response({ probe: readyProbe })
        )
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save and continue' })
        ).toHaveProperty('disabled', false)
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Save and continue' })
      );
      expect(onChatSelected).toHaveBeenCalledWith(chatId);
      expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
      expect(onContinue).not.toHaveBeenCalled();
      await act(async () => selection.resolve());
      expect(onContinue).toHaveBeenCalledOnce();
    }
  );

  test('a committed chat save updates renderer selection even after Skip unmounts the step', async () => {
    settings.provider = 'anthropic';
    const onContinue = vi.fn();
    const onSkip = vi.fn();
    const onChatSelected = vi.fn(async () => undefined);
    const view = render(
      <NotaModelsSetup
        onContinue={onContinue}
        onSkip={onSkip}
        onChatSelected={onChatSelected}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Local chat model')).toHaveProperty(
        'disabled',
        false
      )
    );
    const committed = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(committed.promise);
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: chatId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(requests('POST', '/api/ai/settings')).toHaveLength(1);
    expect(onChatSelected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => committed.resolve(response({ ok: true })));
    expect(onChatSelected).toHaveBeenCalledWith(chatId);
    expect(onContinue).not.toHaveBeenCalled();
  });

  test.each(['download', 'probe'] as const)(
    'a successful chat %s invokes catalog maintenance after Skip without changing provider',
    async action => {
      settings.provider = 'anthropic';
      if (action === 'download') {
        models[0] = {
          ...models[0],
          downloadStatus: 'not_started',
          runtimeProbe: undefined,
        };
      }
      const onContinue = vi.fn();
      const onSkip = vi.fn();
      const onChatSelected = vi.fn();
      const onChatAction = vi.fn(async () => undefined);
      const view = render(
        <NotaModelsSetup
          onContinue={onContinue}
          onSkip={onSkip}
          onChatSelected={onChatSelected}
          onChatAction={onChatAction}
        />
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Local chat model')).toHaveProperty(
          'disabled',
          false
        )
      );
      fireEvent.change(screen.getByLabelText('Local chat model'), {
        target: { value: chatId },
      });
      const actionResult = deferred<ReturnType<typeof response>>();
      fetchMock.mockReturnValueOnce(actionResult.promise);
      fireEvent.click(
        screen.getByRole('button', {
          name: `${action === 'download' ? 'Download' : 'Check'} Qwen3.5 2B`,
        })
      );
      expect(onChatAction).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
      expect(onSkip).toHaveBeenCalledOnce();
      view.unmount();
      await act(async () =>
        actionResult.resolve(
          action === 'download'
            ? response({ download: { status: 'queued' } }, 202)
            : response({ probe: readyProbe })
        )
      );
      expect(onChatAction).toHaveBeenCalledWith(chatId, action);
      expect(onChatSelected).not.toHaveBeenCalled();
      expect(onContinue).not.toHaveBeenCalled();
      expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
    }
  );

  test('catalog callback failure is distinct from an accepted model action', async () => {
    const onChatAction = vi.fn(async () => {
      throw new Error('Catalog offline.');
    });
    render(
      <NotaModelsSetup onContinue={vi.fn()} onChatAction={onChatAction} />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Local chat model')).toHaveProperty(
        'disabled',
        false
      )
    );
    post = () => response({ probe: readyProbe });
    fireEvent.click(screen.getByRole('button', { name: 'Check Qwen3.5 2B' }));
    await screen.findByText(
      'Model check passed. Chat model status could not refresh: Catalog offline.'
    );
    expect(requests('POST').map(([url]) => url)).toEqual([
      `/v1/local/models/${chatId}/probe`,
    ]);
  });

  test('STT save preserves compatible language and does not revalidate unchanged missing chat', async () => {
    models[0].downloadStatus = 'not_started';
    const { onContinue } = await ready();
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'whisper-base-cpp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(JSON.parse(requests('POST', '/api/ai/settings')[0][1].body)).toEqual(
      {
        meetingSttProviderId: 'whisper-base-cpp',
        meetingSttModelId: speechModelId,
        meetingSttLanguage: 'fr',
      }
    );
  });

  test('changing to a fixed-language STT model resets incompatible language to Auto', async () => {
    const { onContinue } = await ready();
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'moonshine-base-onnx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(JSON.parse(requests('POST', '/api/ai/settings')[0][1].body)).toEqual(
      {
        meetingSttProviderId: 'moonshine-base-onnx',
        meetingSttModelId: 'moonshine-model',
        meetingSttLanguage: 'auto',
      }
    );
  });

  test('Auto clears an explicitly selected STT model without changing chat', async () => {
    settings.meetings.sttProviderId = 'whisper-base-cpp';
    settings.meetings.sttModelId = speechModelId;
    const { onContinue } = await ready();
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'auto' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(JSON.parse(requests('POST', '/api/ai/settings')[0][1].body)).toEqual(
      {
        meetingSttProviderId: 'auto',
        meetingSttModelId: '',
        meetingSttLanguage: 'auto',
      }
    );
  });

  test('draft Auto does not claim the saved explicit speech provider or expose its actions', async () => {
    settings.meetings.sttProviderId = 'whisper-base-cpp';
    settings.meetings.sttModelId = speechModelId;
    await ready();
    expect(
      screen.getByRole('button', { name: 'Check Whisper Base Q5' })
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'auto' },
    });
    expect(
      screen.getByText(
        'Auto chooses an available local transcription model after you save.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Check Whisper Base Q5' })
    ).toBeNull();
    expect(screen.queryByText(/Ready for transcription/)).toBeNull();
    expect(requests('POST')).toHaveLength(0);
  });

  test('model guards prevent saving uninstalled chat and unsupported speech choices', async () => {
    providers[1].readiness = { status: 'unsupported' };
    providers[1].unavailableReason = 'Not supported on this Mac.';
    await ready();
    expect(
      screen.getByRole('option', { name: 'Moonshine Base' })
    ).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: smallChatId },
    });
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByRole('button', { name: 'Download Qwen3.5 0.8B' })
    ).toBeTruthy();
    expect(requests('POST')).toHaveLength(0);
  });

  test('explicit download polls progress without replacing either chosen draft; Skip stays enabled', async () => {
    const { onSkip, view } = await ready();
    vi.useFakeTimers();
    post = () => {
      models[1] = { ...models[1], downloadStatus: 'queued', progress: 0 };
      return response({ download: { status: 'queued' } }, 202);
    };
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: smallChatId },
    });
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'whisper-base-cpp' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Download Qwen3.5 0.8B' })
      );
    });
    expect(requests('POST').map(([url]) => url)).toEqual([
      `/v1/local/models/${smallChatId}/download`,
    ]);
    models[1] = { ...models[1], downloadStatus: 'downloading', progress: 0.5 };
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('Downloading 50%')).toBeTruthy();
    expect(screen.getByLabelText('Local chat model')).toHaveProperty(
      'value',
      smallChatId
    );
    expect(screen.getByLabelText('Transcription model')).toHaveProperty(
      'value',
      'whisper-base-cpp'
    );
    expect(requests('GET', '/api/ai/settings')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
    view.unmount();
    const count = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    fireEvent.focus(window);
    expect(fetchMock.mock.calls.length).toBe(count);
  });

  test('download errors retain the model choice and allow retry', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: smallChatId },
    });
    post = () =>
      response({ download: { status: 'error', message: 'Offline.' } }, 409);
    fireEvent.click(
      screen.getByRole('button', { name: 'Download Qwen3.5 0.8B' })
    );
    await screen.findByText('Offline.');
    expect(screen.getByLabelText('Local chat model')).toHaveProperty(
      'value',
      smallChatId
    );
    expect(
      screen.getByRole('button', { name: 'Download Qwen3.5 0.8B' })
    ).toHaveProperty('disabled', false);
  });

  test('an explicit model check reports runtime failure and never silently saves', async () => {
    await ready();
    post = () =>
      response(
        {
          probe: {
            ...readyProbe,
            status: 'failed',
            canLoad: false,
            message: 'Runtime cannot load.',
          },
        },
        409
      );
    fireEvent.click(screen.getByRole('button', { name: 'Check Qwen3.5 2B' }));
    await screen.findByText('Runtime cannot load.');
    expect(requests('POST').map(([url]) => url)).toEqual([
      `/v1/local/models/${chatId}/probe`,
    ]);
  });

  test('failed settings save keeps both choices and does not advance until retry succeeds', async () => {
    models[1] = {
      ...models[1],
      downloadStatus: 'downloaded',
      runtimeProbe: readyProbe,
    };
    const { onContinue } = await ready();
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: smallChatId },
    });
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'whisper-base-cpp' },
    });
    post = () => response({ error: 'Could not write settings.' }, 500);
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Could not write settings.');
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Local chat model')).toHaveProperty(
      'value',
      smallChatId
    );
    expect(screen.getByLabelText('Transcription model')).toHaveProperty(
      'value',
      'whisper-base-cpp'
    );
    post = () => response({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(requests('POST', '/api/ai/settings')).toHaveLength(2);
  });

  test('backend failure keeps Skip available and status can be retried', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Backend is unavailable.'));
    const onSkip = vi.fn();
    render(<NotaModelsSetup onContinue={vi.fn()} onSkip={onSkip} />);
    await screen.findByText(/Backend is unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry model status' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Local chat model')).toHaveProperty(
        'disabled',
        false
      )
    );
    expect(requests('POST')).toHaveLength(0);
  });

  test('focus refresh preserves drafts and StrictMode never triggers model mutations', async () => {
    render(
      <StrictMode>
        <NotaModelsSetup onContinue={vi.fn()} />
      </StrictMode>
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Local chat model')).toHaveProperty(
        'disabled',
        false
      )
    );
    fireEvent.change(screen.getByLabelText('Local chat model'), {
      target: { value: smallChatId },
    });
    const initialSettingsReads = requests('GET', '/api/ai/settings').length;
    await act(async () => fireEvent.focus(window));
    expect(screen.getByLabelText('Local chat model')).toHaveProperty(
      'value',
      smallChatId
    );
    expect(requests('GET', '/api/ai/settings')).toHaveLength(
      initialSettingsReads
    );
    expect(requests('POST')).toHaveLength(0);
  });
});
