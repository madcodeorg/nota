// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type PropsWithChildren, type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ChatGPTStatus } from '../../dialogs/setting/general-setting/ai/chatgpt-connection';

const browser = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('@nota/core/modules/url', () => ({ UrlService: Symbol('UrlService') }));
vi.mock('@nota/infra', () => ({ useServiceOptional: () => browser }));
vi.mock('@nota/component', () => ({
  Button: ({
    children,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Input: ({ onChange, ...props }: { onChange: (value: string) => void }) => (
    <input {...props} onChange={event => onChange(event.target.value)} />
  ),
  Menu: ({ items, children }: PropsWithChildren<{ items: ReactNode }>) => (
    <div>
      {children}
      {items}
    </div>
  ),
  MenuItem: ({
    onSelect,
    selected: _selected,
    children,
    ...props
  }: PropsWithChildren<{ onSelect: () => void; selected?: boolean }>) => (
    <button {...props} onClick={onSelect}>
      {children}
    </button>
  ),
  MenuTrigger: ({
    children,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@nota/component/setting-components', () => ({
  SettingRow: ({
    name,
    desc,
    children,
  }: PropsWithChildren<{ name: string; desc?: string }>) => (
    <div>
      <label>{name}</label>
      <span>{desc}</span>
      {children}
    </div>
  ),
}));

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
  chatgptModel?: string;
  localModel: string;
  meetings: {
    sttProviderId: string;
    sttModelId: string;
    sttLanguage: string;
  };
};
let chatgptStatus: ChatGPTStatus;
let accountCatalog: Array<{ id: string; name: string }>;
let accountStatusHTTP: number;
let accountCatalogHTTP: number;
let models: Record<string, unknown>[];
let providers: Record<string, unknown>[];
let runtime: Record<string, unknown>;
let post: (
  url: string,
  init?: RequestInit
) => ReturnType<typeof response> | Promise<ReturnType<typeof response>>;
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
    browser.openExternal.mockClear();
    chatgptStatus = {
      connected: false,
      planEnabled: false,
      pending: false,
      profiles: [],
    };
    accountCatalog = [{ id: 'gpt-account-model', name: 'Account GPT' }];
    accountStatusHTTP = 200;
    accountCatalogHTTP = 200;
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
      if (url === '/api/ai/chatgpt/status')
        return response(chatgptStatus, accountStatusHTTP);
      if (url === '/api/ai/chatgpt/models')
        return response({ models: accountCatalog }, accountCatalogHTTP);
      if (url === '/api/ai/chatgpt/sign-in') {
        chatgptStatus = { ...chatgptStatus, pending: true };
        return response({
          url: 'https://auth.openai.com/oauth/authorize?state=test',
        });
      }
      if (url === '/api/ai/chatgpt/disconnect') {
        chatgptStatus = {
          connected: false,
          planEnabled: false,
          pending: false,
          profiles: [],
        };
        return response({ ok: true });
      }
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

  async function chooseChatGPT(
    onContinue = vi.fn(),
    onSkip = vi.fn(),
    onChatSelected = vi.fn()
  ) {
    const view = render(
      <NotaModelsSetup
        mode="chat"
        onContinue={onContinue}
        onSkip={onSkip}
        onChatSelected={onChatSelected}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Chat provider')).toHaveProperty(
        'disabled',
        false
      )
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Chat provider'), {
        target: { value: 'chatgpt' },
      });
    });
    return { view, onContinue, onSkip, onChatSelected };
  }

  test('sign-in never selects a model or saves until the user chooses ChatGPT and continues', async () => {
    const { onContinue, onChatSelected } = await chooseChatGPT();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('Continue with ChatGPT'));
    });
    expect(browser.openExternal).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/authorize?state=test'
    );
    expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', true);
    chatgptStatus = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByLabelText('ChatGPT models').textContent).toBe(
      'Choose model'
    );
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByText('Account GPT'));
    });
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', false);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Save and continue' })
      );
    });
    const payload = JSON.parse(requests('POST', '/api/ai/settings')[0][1].body);
    expect(payload).toEqual({
      defaultProvider: 'chatgpt',
      defaultModel: 'gpt-account-model',
      chatgptModel: 'gpt-account-model',
    });
    expect(onChatSelected).toHaveBeenCalledWith('gpt-account-model', 'chatgpt');
    expect(onContinue).toHaveBeenCalledOnce();
  });

  test.each(['ineligible', 'pending', 'unlisted'] as const)(
    'blocks ChatGPT saves with %s account/model state',
    async state => {
      chatgptStatus = {
        connected: true,
        planEnabled: state !== 'ineligible',
        pending: state === 'pending',
        activeProfileId: 'one',
        profiles: [],
      };
      settings.chatgptModel =
        state === 'unlisted' ? 'not-in-account' : 'gpt-account-model';
      const { onContinue } = await chooseChatGPT();
      expect(screen.getByLabelText('ChatGPT models').textContent).toBe(
        'Choose model'
      );
      expect(screen.queryByLabelText('Model ID')).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Save and continue' })
      ).toHaveProperty('disabled', true);
      fireEvent.click(
        screen.getByRole('button', { name: 'Save and continue' })
      );
      expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
      expect(onContinue).not.toHaveBeenCalled();
    }
  );

  test('failed ChatGPT save retains the draft and only advances after retry', async () => {
    chatgptStatus = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    const { onContinue, onChatSelected } = await chooseChatGPT();
    await act(async () => {
      fireEvent.click(screen.getByText('Account GPT'));
    });
    post = () => response({ error: 'Account changed; retry.' }, 409);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Save and continue' })
      );
    });
    expect(screen.getByRole('alert').textContent).toContain('Account changed');
    expect(screen.getByLabelText('ChatGPT models').textContent).toBe(
      'Account GPT'
    );
    expect(onContinue).not.toHaveBeenCalled();
    expect(onChatSelected).not.toHaveBeenCalled();
    post = () => response({ ok: true });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Save and continue' })
      );
    });
    expect(onContinue).toHaveBeenCalledOnce();
  });

  test('disconnect clears selectable account models and Skip remains available during a backend outage', async () => {
    chatgptStatus = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    const { onSkip } = await chooseChatGPT();
    await act(async () => {
      fireEvent.click(screen.getByText('Account GPT'));
    });
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', false);
    await act(async () => {
      fireEvent.click(screen.getByText('Disconnect'));
    });
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', true);
    expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Chat provider'), {
        target: { value: 'local' },
      });
    });
    accountStatusHTTP = 503;
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Chat provider'), {
        target: { value: 'chatgpt' },
      });
    });
    expect(screen.getByRole('alert').textContent).toContain('unavailable');
    fireEvent.click(screen.getByText('Skip for now'));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
  });

  test('catalog refresh that expires authentication disables Save without changing the model draft', async () => {
    chatgptStatus = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    await chooseChatGPT();
    await act(async () => {
      fireEvent.click(screen.getByText('Account GPT'));
    });
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', false);
    chatgptStatus = {
      connected: false,
      planEnabled: false,
      pending: false,
      profiles: [],
    };
    accountCatalogHTTP = 401;
    await act(async () => {
      fireEvent.click(screen.getByText('Refresh models'));
    });
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('ChatGPT models')).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByLabelText('ChatGPT models').textContent).toBe(
      'Choose model'
    );
    expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
    chatgptStatus = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    accountCatalogHTTP = 200;
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Chat provider'), {
        target: { value: 'local' },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Chat provider'), {
        target: { value: 'chatgpt' },
      });
    });
    expect(screen.getByLabelText('ChatGPT models').textContent).toBe(
      'Account GPT'
    );
    expect(
      screen.getByRole('button', { name: 'Save and continue' })
    ).toHaveProperty('disabled', false);
    expect(requests('POST', '/api/ai/settings')).toHaveLength(0);
  });

  test('committed ChatGPT selection synchronizes the renderer even after Skip unmounts setup', async () => {
    chatgptStatus = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    const { view, onContinue, onSkip, onChatSelected } = await chooseChatGPT();
    await act(async () => {
      fireEvent.click(screen.getByText('Account GPT'));
    });
    const saved = deferred<ReturnType<typeof response>>();
    post = () => saved.promise;
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    fireEvent.click(screen.getByText('Skip for now'));
    expect(onSkip).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => {
      saved.resolve(response({ ok: true }));
    });
    expect(onChatSelected).toHaveBeenCalledWith('gpt-account-model', 'chatgpt');
    expect(onContinue).not.toHaveBeenCalled();
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
  test('offers the optional after-meeting model with its RAM note and downloads only on request', async () => {
    const turboId = 'whisper-large-v3-turbo-q5-cpp';
    models.push({
      ...baseModel,
      id: turboId,
      type: 'stt',
      sizeMb: 548,
      minRamGb: 4,
      languages: ['en', 'fr'],
      downloadStatus: 'not_started',
    });
    await ready();
    expect(
      screen.getByText('After-meeting transcript (optional)')
    ).toBeTruthy();
    expect(screen.getByText(/about 2 GB more RAM/)).toBeTruthy();
    expect(requests('POST')).toHaveLength(0);
    post = () => {
      models[models.length - 1] = {
        ...models[models.length - 1],
        downloadStatus: 'queued',
        progress: 0,
      };
      return response({ download: { status: 'queued' } }, 202);
    };
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Download Whisper Large v3 Turbo',
        })
      );
    });
    expect(requests('POST').map(([url]) => url)).toEqual([
      `/v1/local/models/${turboId}/download`,
    ]);
  });

  test('hides the after-meeting section when the backend does not list the model', async () => {
    await ready();
    expect(
      screen.queryByText('After-meeting transcript (optional)')
    ).toBeNull();
  });
});
