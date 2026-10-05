// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { LocalModelInfo } from './model-list';

const mocks = vi.hoisted(() => ({
  models: {
    refreshModels: vi.fn(),
    watchLocalModelDownload: vi.fn(),
  },
  featureFlag: {
    flags: {
      // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
      enable_ai: { $: { value: true }, set: vi.fn() },
    },
  },
  server: {
    server: {
      // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
      features$: { value: { copilot: true } },
    },
  },
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@nota/core/modules/ai-button/services/models', () => ({
  AIModelService: Symbol('AIModelService'),
}));
vi.mock('@nota/core/modules/cloud', () => ({
  ServerService: Symbol('ServerService'),
}));
vi.mock('@nota/core/modules/feature-flag', () => ({
  FeatureFlagService: Symbol('FeatureFlagService'),
}));
vi.mock('@nota/infra', () => ({
  useLiveData: (source: { value: unknown }) => source.value,
  useServices: () => ({
    aIModelService: mocks.models,
    featureFlagService: mocks.featureFlag,
    serverService: mocks.server,
  }),
}));
vi.mock('@blocksuite/icons/rc', () => ({
  DownloadIcon: () => null,
  ResetIcon: () => null,
}));
vi.mock('@nota/component', async () => {
  const { Tabs } = await import('@nota/component/ui/tabs');
  const Button = ({
    children,
    loading,
    disabled,
    prefix: _prefix,
    block: _block,
    icon: _icon,
    tooltip: _tooltip,
    variant: _variant,
    contentClassName: _contentClassName,
    ...props
  }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'prefix'> & {
    loading?: boolean;
    prefix?: ReactNode;
    block?: boolean;
    icon?: ReactNode;
    tooltip?: string;
    variant?: string;
    contentClassName?: string;
  }) => (
    <button {...props} disabled={disabled || loading}>
      {children}
    </button>
  );
  return {
    Button,
    IconButton: Button,
    MenuTrigger: Button,
    // Keep menu options inline; the real tabs and model list remain mounted.
    Menu: ({ children, items }: { children: ReactNode; items: ReactNode }) => (
      <div>
        {children}
        <div role="menu">{items}</div>
      </div>
    ),
    MenuItem: ({
      children,
      onSelect,
      selected,
      disabled,
      ...props
    }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & {
      onSelect: () => void;
      selected?: boolean;
    }) => (
      // Forward disabled menu callbacks to exercise the panel's own guards.
      <button
        {...props}
        role="menuitem"
        aria-disabled={disabled}
        data-selected={selected}
        onClick={onSelect}
      >
        {children}
      </button>
    ),
    Input: ({
      onChange,
      ...props
    }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
      onChange: (value: string) => void;
    }) => (
      <input
        {...props}
        onChange={event => onChange(event.currentTarget.value)}
      />
    ),
    Switch: ({
      onChange,
      ...props
    }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
      onChange: (checked: boolean) => void;
    }) => (
      <input
        {...props}
        type="checkbox"
        role="switch"
        onChange={event => onChange(event.currentTarget.checked)}
      />
    ),
    Progress: ({ value }: { value: number }) => (
      <progress max={100} value={value} />
    ),
    Tabs,
    notify: mocks.notify,
  };
});
vi.mock('@nota/component/setting-components', () => ({
  SettingHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  SettingRow: ({
    name,
    desc,
    children,
  }: {
    name: string;
    desc?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h3>{name}</h3>
      <div>{desc}</div>
      {children}
    </div>
  ),
}));

import { AISettingsPanel } from './index';

const gemmaId = 'gemma-4-e2b-it-onnx-q4f16';
const qwenId = 'qwen3.5-0.8b-onnx-q4f16';
const embeddingId = 'all-minilm-l6-v2-embedding';
const alternateEmbeddingId = 'test-embedding';

function localModel(
  id: string,
  overrides: Partial<LocalModelInfo> = {}
): LocalModelInfo {
  return {
    id,
    type: 'text',
    runtime: 'onnxruntime-node',
    sizeMb: 100,
    minRamGb: 2,
    tier: 'small',
    releaseState: 'ready',
    deviceFit: 'fits',
    downloadStatus: 'not_started',
    progress: 0,
    ...overrides,
  };
}

function healthyProbe(): NonNullable<LocalModelInfo['runtimeProbe']> {
  return {
    canLoad: true,
    runtimeAvailable: true,
    status: 'available',
    message: 'Model loaded successfully.',
  };
}

function backendSettings() {
  return {
    provider: 'local',
    model: gemmaId,
    localModel: gemmaId,
    localBaseUrl: 'http://localhost:11434/v1',
    openaiModel: 'saved-openai-model',
    anthropicModel: 'saved-anthropic-model',
    googleModel: 'saved-google-model',
    providers: ['local', 'openai', 'anthropic', 'google', 'custom'],
    models: {
      defaultModel: `local:${gemmaId}`,
      optionalModels: [
        { id: `local:${gemmaId}`, name: 'Gemma 4 E2B', selectable: false },
        { id: `local:${qwenId}`, name: 'Qwen3.5 0.8B', selectable: true },
      ],
      proModels: [],
    },
    compatibleProviders: {
      custom: {
        baseUrl: 'https://saved.example.test/v1',
        model: 'saved-compatible-model',
        hasKey: true,
      },
    },
    imageProvider: 'google',
    openaiImageModel: 'saved-openai-image',
    googleImageModel: 'saved-google-image',
    localImageModel: 'saved-local-image',
    tools: {
      embeddingAllowRemote: false,
      embeddingMode: 'auto',
      embeddingModel: embeddingId,
      enabled: true,
      webCrawl: true,
      shell: true,
      workspaceSearch: true,
      maxSteps: 7,
    },
    mcp: {
      enabled: true,
      config: '{"mcpServers":{"saved":{"command":"test-only"}}}',
      toolNames: ['saved-tool'],
      servers: [],
    },
    hasKeys: { local: true, openai: false, custom: true },
    meetings: {
      localModels: [
        localModel(gemmaId),
        localModel(qwenId, {
          downloadStatus: 'downloaded',
          progress: 1,
          runtimeProbe: healthyProbe(),
        }),
        localModel(embeddingId, {
          type: 'embedding',
          downloadStatus: 'downloaded',
          progress: 1,
        }),
        localModel(alternateEmbeddingId, {
          type: 'embedding',
          downloadStatus: 'downloaded',
          progress: 1,
        }),
      ],
      sttProviders: [],
      transcriptionAvailable: false,
    },
    capabilities: {
      chat: false,
      context: false,
      imageGeneration: false,
      tools: false,
      webCrawl: false,
      shell: false,
      workspaceSearch: false,
      mcp: false,
      appActions: false,
      databaseCreation: false,
      meetingTranscription: false,
      noteCreation: false,
      mindMapCreation: false,
    },
  };
}

const fetchMock = vi.fn<typeof fetch>();
let settings: ReturnType<typeof backendSettings>;
let models: LocalModelInfo[];
let downloadStatus: number;
let download: { status: string; message: string };
let probe: NonNullable<LocalModelInfo['runtimeProbe']>;
let unexpectedRequests: string[];

function requests(path: string, method = 'GET') {
  return fetchMock.mock.calls.filter(
    ([url, init]) => url === path && (init?.method ?? 'GET') === method
  );
}

function posts() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
}

function modelAction(name: string, action: string) {
  return within(screen.getByRole('listitem', { name })).getByRole('button', {
    name: action,
  });
}

function fieldValue(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function selectTab(name: string) {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole('tab', { name }), {
      button: 0,
      ctrlKey: false,
    });
  });
}

async function mountSettings(scope: 'all' | 'embeddings' = 'all') {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<AISettingsPanel scope={scope} />);
  });
  return view;
}

async function refreshHealth(method: 'refresh' | 'poll') {
  if (method === 'refresh') {
    await click(screen.getByRole('button', { name: 'Refresh model status' }));
  } else {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.models.refreshModels.mockResolvedValue(undefined);
  settings = backendSettings();
  models = settings.meetings.localModels;
  downloadStatus = 409;
  download = { status: 'error', message: 'The model download failed.' };
  probe = healthyProbe();
  unexpectedRequests = [];
  fetchMock.mockImplementation(async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/ai/settings') {
      return Response.json(settings);
    }
    if (method === 'GET' && url === '/v1/local/models') {
      return Response.json({ models });
    }
    if (method === 'POST' && url === '/api/ai/settings') {
      return Response.json({ ok: true });
    }
    if (
      method === 'POST' &&
      [gemmaId, qwenId].some(id => url === `/v1/local/models/${id}/download`)
    ) {
      return Response.json({ download }, { status: downloadStatus });
    }
    if (
      method === 'POST' &&
      [gemmaId, qwenId].some(id => url === `/v1/local/models/${id}/probe`)
    ) {
      return Response.json({ probe });
    }
    unexpectedRequests.push(`${method} ${String(url)}`);
    throw new Error(`Unexpected request: ${method} ${String(url)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});

describe('AI settings panel', () => {
  test('shows context and use guidance without blocking an installed smaller model', async () => {
    const model = models.find(model => model.id === qwenId)!;
    model.contextWindowTokens = 262144;
    model.usageGuidance = 'Compact chat. May omit owners in summaries.';
    await mountSettings();
    const row = within(screen.getByRole('listitem', { name: 'Qwen3.5 0.8B' }));
    expect(row.getByText(model.usageGuidance)).toBeTruthy();
    expect(row.getByText('262,144 token context')).toBeTruthy();
    expect(
      (row.getByRole('button', { name: 'Select' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  test('allows saving 50 tool rounds from an existing lower budget', async () => {
    settings.tools.maxSteps = 4;
    await mountSettings();
    await selectTab('Advanced');
    const input = screen.getByRole('spinbutton', { name: 'Max tool steps' });
    expect((input as HTMLInputElement).value).toBe('4');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('50');
    expect(
      screen.getByText(
        'Allows 1–50 tool rounds, followed by a final answer if the limit is reached.'
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.change(input, { target: { value: '50' } });
    });
    await click(screen.getByRole('button', { name: 'Save changes' }));
    expect(posts()).toHaveLength(1);
    expect(
      JSON.parse(requests('/api/ai/settings', 'POST')[0][1]?.body as string)
    ).toMatchObject({ toolMaxSteps: 50 });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'AI settings saved',
    });
  });

  test('separates Models, Search, and Advanced into accessible tabs', async () => {
    await mountSettings();
    const tabs = screen.getByRole('tablist', { name: 'AI settings sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map(tab => tab.textContent)
    ).toEqual(['Models', 'Search', 'Advanced']);
    expect(
      screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected')
    ).toBe('true');
    expect(
      within(screen.getByRole('tabpanel', { name: 'Models' })).getByRole(
        'button',
        { name: 'Provider' }
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search mode' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'MCP' })).toBeNull();

    await selectTab('Search');
    expect(
      within(screen.getByRole('tabpanel', { name: 'Search' })).getByRole(
        'button',
        { name: 'Embedding model' }
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Provider' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'MCP' })).toBeNull();

    await selectTab('Advanced');
    const advanced = screen.getByRole('tabpanel', { name: 'Advanced' });
    expect(
      within(advanced).getByRole('heading', { name: 'Image Generation' })
    ).toBeTruthy();
    expect(within(advanced).getByRole('heading', { name: 'MCP' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Embedding model' })
    ).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Save changes' })
    ).toHaveLength(1);
    expect(posts()).toHaveLength(0);
  });

  test.each(['not_started', 'failed', 'missing_runtime'] as const)(
    'retains configured Gemma with %s readiness and omits unchanged text selection when saving Search',
    async status => {
      settings.meetings.localModels[0] = localModel(
        gemmaId,
        status === 'not_started'
          ? {}
          : {
              downloadStatus: 'downloaded',
              runtimeProbe: {
                status,
                canLoad: false,
                runtimeAvailable: status !== 'missing_runtime',
                message: 'Configured Gemma cannot load.',
              },
            }
      );
      models = settings.meetings.localModels;
      await mountSettings();
      await refreshHealth('refresh');

      expect(
        screen.getByRole('button', { name: 'Chat model' }).textContent
      ).toBe('Gemma 4 E2B');
      expect(
        screen.getByRole('menuitem', { name: /Gemma 4 E2B/ }).dataset.selected
      ).toBe('true');
      expect(
        screen.getByRole('menuitem', { name: /Qwen3.5 0.8B/ }).dataset.selected
      ).toBe('false');
      const selectedRow = within(
        screen.getByRole('listitem', { name: 'Gemma 4 E2B' })
      );
      expect(selectedRow.getByText('Selected')).toBeTruthy();
      expect(selectedRow.queryByText(/^(Ready|Check passed)$/)).toBeNull();
      expect(posts()).toHaveLength(0);

      await selectTab('Search');
      await click(screen.getByRole('menuitem', { name: 'Keyword fallback' }));
      await click(screen.getByRole('button', { name: 'Save changes' }));
      expect(requests('/api/ai/settings', 'POST')).toHaveLength(1);
      const payload = JSON.parse(
        requests('/api/ai/settings', 'POST')[0][1]?.body as string
      );
      expect(payload.embeddingMode).toBe('fallback');
      expect(payload).not.toHaveProperty('defaultProvider');
      expect(payload).not.toHaveProperty('defaultModel');
      expect(payload).not.toHaveProperty('localModel');
      expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
        title: 'AI settings saved',
      });
      expect(mocks.notify.error).not.toHaveBeenCalled();

      await selectTab('Models');
      expect(
        screen.getByRole('button', { name: 'Chat model' }).textContent
      ).toBe('Gemma 4 E2B');
      expect(
        screen.getByRole('menuitem', { name: /Gemma 4 E2B/ }).dataset.selected
      ).toBe('true');
      expect(
        screen.getByRole('menuitem', { name: /Qwen3.5 0.8B/ }).dataset.selected
      ).toBe('false');
      const savedRow = within(
        screen.getByRole('listitem', { name: 'Gemma 4 E2B' })
      );
      expect(savedRow.getByText('Selected')).toBeTruthy();
      expect(savedRow.queryByText(/^(Ready|Check passed)$/)).toBeNull();
    }
  );

  test('includes text selection fields when changing to an installed local model', async () => {
    await mountSettings();
    await click(modelAction('Qwen3.5 0.8B', 'Select'));
    expect(screen.getByRole('button', { name: 'Chat model' }).textContent).toBe(
      'Qwen3.5 0.8B'
    );

    await click(screen.getByRole('button', { name: 'Save changes' }));

    expect(requests('/api/ai/settings', 'POST')).toHaveLength(1);
    const payload = JSON.parse(
      requests('/api/ai/settings', 'POST')[0][1]?.body as string
    );
    expect(payload).toMatchObject({
      defaultProvider: 'local',
      defaultModel: qwenId,
      localModel: qwenId,
    });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'AI settings saved',
    });
    expect(mocks.notify.error).not.toHaveBeenCalled();
  });

  test('allows checking a downloaded model with a cached missing_model probe but not selecting it', async () => {
    settings.meetings.localModels[1] = localModel(qwenId, {
      downloadStatus: 'downloaded',
      runtimeProbe: {
        status: 'missing_model',
        canLoad: false,
        runtimeAvailable: true,
        message: 'Model files were missing at the last check.',
      },
    });
    await mountSettings();

    const row = within(screen.getByRole('listitem', { name: 'Qwen3.5 0.8B' }));
    expect(
      (row.getByRole('button', { name: 'Check model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(row.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(
      screen
        .getByRole('menuitem', { name: /Qwen3.5 0.8B/ })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(posts()).toHaveLength(0);
  });

  test('hides unreleased chat and embedding entries but retains device-blocked models', async () => {
    const unreleased: Partial<LocalModelInfo>[] = [
      { releaseState: 'planned' },
      { releaseState: 'blocked' },
      { downloadStatus: 'planned' },
      { downloadStatus: 'missing_url' },
    ];
    for (const type of ['text', 'embedding'] as const) {
      unreleased.forEach((state, index) => {
        settings.meetings.localModels.push(
          localModel(`Future-${type}-${index}`, { type, ...state })
        );
      });
    }
    settings.meetings.localModels.push(
      localModel('device-blocked-model', {
        deviceFit: 'low_disk',
        downloadStatus: 'blocked',
        deviceFitReason: 'Free more disk space to download.',
      })
    );
    await mountSettings();

    expect(screen.queryByText(/Future/)).toBeNull();
    const blocked = within(
      screen.getByRole('listitem', { name: 'device-blocked-model' })
    );
    expect(blocked.getByText('Free more disk space to download.')).toBeTruthy();
    expect(blocked.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(
      screen
        .getByRole('menuitem', { name: /device-blocked-model/ })
        .getAttribute('aria-disabled')
    ).toBe('true');

    await selectTab('Search');
    expect(screen.queryByText(/Future/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(posts()).toHaveLength(0);
  });

  test('ignores unavailable model menu callbacks instead of replacing the draft', async () => {
    settings.provider = 'openai';
    settings.model = settings.openaiModel;
    await mountSettings();
    await click(screen.getByRole('menuitem', { name: 'Local' }));
    await click(modelAction('Qwen3.5 0.8B', 'Select'));
    const unavailable = screen.getByRole('menuitem', { name: /Gemma 4 E2B/ });
    expect(unavailable.getAttribute('aria-disabled')).toBe('true');

    await click(unavailable);

    expect(screen.getByRole('button', { name: 'Chat model' }).textContent).toBe(
      'Qwen3.5 0.8B'
    );
    expect(posts()).toHaveLength(0);
  });

  describe.each(['refresh', 'poll'] as const)('%s model health', method => {
    test.each([
      ['OpenAI', 'OpenAI API key'],
      ['Custom compatible', 'Custom compatible API key'],
    ])(
      'preserves unsaved %s credentials, model, and search fields',
      async (provider, keyLabel) => {
        settings.meetings.localModels[0] = localModel(gemmaId, {
          downloadStatus: 'downloading',
          progress: 0.25,
        });
        models = settings.meetings.localModels;
        await mountSettings();
        await click(screen.getByRole('menuitem', { name: provider }));
        fireEvent.change(screen.getByLabelText(keyLabel), {
          target: { value: 'test-only-unsaved-key' },
        });
        fireEvent.change(screen.getByLabelText('Model ID'), {
          target: { value: 'unsaved-chat-model' },
        });
        if (provider === 'Custom compatible') {
          fireEvent.change(screen.getByLabelText('Base URL'), {
            target: { value: 'https://draft.example.test/v1' },
          });
        }
        await selectTab('Search');
        await click(screen.getByRole('menuitem', { name: 'Force semantic' }));
        await click(
          screen.getByRole('menuitem', { name: alternateEmbeddingId })
        );
        await click(
          screen.getByRole('switch', { name: 'Automatic model downloads' })
        );
        await click(screen.getByRole('switch', { name: 'Workspace search' }));

        models = models.map(item =>
          item.id === gemmaId
            ? { ...item, downloadStatus: 'downloaded', progress: 1 }
            : item
        );
        await refreshHealth(method);

        expect(requests('/v1/local/models')).toHaveLength(1);
        expect(requests('/api/ai/settings')).toHaveLength(1);
        expect(mocks.models.refreshModels).toHaveBeenCalledTimes(2);
        expect(
          screen.getByRole('button', { name: 'Search mode' }).textContent
        ).toBe('Force semantic');
        expect(
          screen.getByRole('button', { name: 'Embedding model' }).textContent
        ).toBe(alternateEmbeddingId);
        expect(
          (
            screen.getByLabelText(
              'Automatic model downloads'
            ) as HTMLInputElement
          ).checked
        ).toBe(true);
        expect(
          (screen.getByLabelText('Workspace search') as HTMLInputElement)
            .checked
        ).toBe(false);
        await selectTab('Models');
        expect(
          screen.getByRole('button', { name: 'Provider' }).textContent
        ).toBe(provider);
        expect(fieldValue(keyLabel)).toBe('test-only-unsaved-key');
        expect(fieldValue('Model ID')).toBe('unsaved-chat-model');
        if (provider === 'Custom compatible') {
          expect(fieldValue('Base URL')).toBe('https://draft.example.test/v1');
        }
        expect(
          within(
            screen.getByRole('listitem', { name: 'Gemma 4 E2B' })
          ).getByText('Downloaded - Not checked')
        ).toBeTruthy();
        expect(posts()).toHaveLength(0);
        expect(mocks.notify.success).not.toHaveBeenCalled();
        expect(mocks.notify.error).not.toHaveBeenCalled();
        await refreshHealth('poll');
        expect(requests('/v1/local/models')).toHaveLength(1);
        expect(mocks.models.refreshModels).toHaveBeenCalledTimes(2);
        expect(mocks.models.watchLocalModelDownload).not.toHaveBeenCalled();
      }
    );

    test('preserves an unsaved local endpoint and model ID', async () => {
      settings.meetings.localModels[0] = localModel(gemmaId, {
        downloadStatus: 'downloading',
      });
      await mountSettings();
      await click(screen.getByRole('menuitem', { name: 'Local endpoint' }));
      fireEvent.change(screen.getByLabelText('Model ID'), {
        target: { value: 'draft-local-model' },
      });
      fireEvent.change(screen.getByLabelText('Local endpoint'), {
        target: { value: 'http://localhost:23456/v1' },
      });

      await refreshHealth(method);

      expect(
        screen.getByRole('button', { name: 'Chat model' }).textContent
      ).toBe('Local endpoint');
      expect(fieldValue('Model ID')).toBe('draft-local-model');
      expect(fieldValue('Local endpoint')).toBe('http://localhost:23456/v1');
      expect(requests('/api/ai/settings')).toHaveLength(1);
      expect(requests('/v1/local/models')).toHaveLength(1);
      expect(posts()).toHaveLength(0);
    });
  });

  test.each(['error', 'blocked', 'planned', 'missing_url'])(
    'reports HTTP 409 %s download as an error, never success',
    async status => {
      download = { status, message: `Download rejected: ${status}.` };
      await mountSettings();

      await click(modelAction('Gemma 4 E2B', 'Download'));

      expect(
        requests(`/v1/local/models/${gemmaId}/download`, 'POST')
      ).toHaveLength(1);
      expect(screen.getByRole('alert').textContent).toBe(download.message);
      expect(mocks.notify.error).toHaveBeenCalledExactlyOnceWith({
        title: download.message,
      });
      expect(mocks.notify.success).not.toHaveBeenCalled();
      expect(mocks.models.watchLocalModelDownload).not.toHaveBeenCalled();
      expect(
        (modelAction('Gemma 4 E2B', 'Download') as HTMLButtonElement).disabled
      ).toBe(false);
      expect(requests('/api/ai/settings')).toHaveLength(1);
    }
  );

  test.each([
    ['queued', 'Model download queued'],
    ['downloading', 'Model downloading'],
    ['downloaded', 'Model already downloaded'],
  ] as const)(
    'accepts an HTTP 409 %s download without claiming runtime readiness',
    async (status, title) => {
      download = { status, message: '' };
      models = models.map(item =>
        item.id === gemmaId ? { ...item, downloadStatus: status } : item
      );
      await mountSettings();

      await click(modelAction('Gemma 4 E2B', 'Download'));

      expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({ title });
      expect(mocks.notify.error).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        within(
          screen.getByRole('listitem', { name: 'Gemma 4 E2B' })
        ).queryByText(/^(Ready|Check passed)$/)
      ).toBeNull();
      expect(mocks.models.watchLocalModelDownload).not.toHaveBeenCalled();
      expect(requests('/api/ai/settings')).toHaveLength(1);
      expect(requests('/v1/local/models')).toHaveLength(1);
    }
  );

  test.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    'does not report probe success with canLoad=%s and runtimeAvailable=%s',
    async (canLoad, runtimeAvailable) => {
      probe = {
        status: 'available',
        canLoad,
        runtimeAvailable,
        message: 'Runtime did not verify model readiness.',
      };
      models = models.map(item =>
        item.id === qwenId ? { ...item, runtimeProbe: probe } : item
      );
      await mountSettings();

      await click(modelAction('Qwen3.5 0.8B', 'Check model'));

      expect(requests(`/v1/local/models/${qwenId}/probe`, 'POST')).toHaveLength(
        1
      );
      expect(requests('/v1/local/models')).toHaveLength(1);
      expect(screen.getByRole('alert').textContent).toBe(probe.message);
      expect(mocks.notify.error).toHaveBeenCalledExactlyOnceWith({
        title: probe.message,
      });
      expect(mocks.notify.success).not.toHaveBeenCalled();
      expect(
        within(
          screen.getByRole('listitem', { name: 'Qwen3.5 0.8B' })
        ).queryByText(/^(Ready|Check passed)$/)
      ).toBeNull();
    }
  );

  test('reports success only for an available probe with both readiness flags true', async () => {
    await mountSettings();

    await click(modelAction('Qwen3.5 0.8B', 'Check model'));

    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'Model check passed',
      message: probe.message,
    });
    expect(mocks.notify.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      within(screen.getByRole('listitem', { name: 'Qwen3.5 0.8B' })).getByText(
        'Check passed'
      )
    ).toBeTruthy();
  });

  test('keeps a selected model unavailable after a failed probe even when health refresh fails', async () => {
    settings.model = qwenId;
    settings.localModel = qwenId;
    settings.models.defaultModel = `local:${qwenId}`;
    await mountSettings();
    const row = within(screen.getByRole('listitem', { name: 'Qwen3.5 0.8B' }));
    expect(row.getByText('Check passed')).toBeTruthy();
    expect(
      screen
        .getByRole('menuitem', { name: /Qwen3.5 0.8B/ })
        .getAttribute('aria-disabled')
    ).toBe('false');
    const message = 'The selected model failed to load.';
    const health = Promise.withResolvers<Response>();
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          probe: {
            ...healthyProbe(),
            status: 'failed',
            canLoad: false,
            message,
          },
        })
      )
      .mockImplementationOnce(() => health.promise);

    await click(modelAction('Qwen3.5 0.8B', 'Check model'));

    // Probe evidence must replace stale success before the health GET settles.
    const option = screen.getByRole('menuitem', {
      name: 'Qwen3.5 0.8B - Load failed',
    });
    expect(option.dataset.selected).toBe('true');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(requests('/v1/local/models')).toHaveLength(1);
    await act(async () => {
      health.resolve(
        Response.json(
          { error: 'Health temporarily unavailable.' },
          { status: 503 }
        )
      );
    });

    expect(row.getByText('Load failed')).toBeTruthy();
    expect(row.getByText('Selected')).toBeTruthy();
    expect(row.queryByText(/^(Ready|Check passed)$/)).toBeNull();
    expect(row.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Chat model' }).textContent).toBe(
      'Qwen3.5 0.8B'
    );
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(mocks.notify.error).toHaveBeenCalledExactlyOnceWith({
      title: message,
    });
    expect(mocks.notify.success).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
    expect(requests(`/v1/local/models/${qwenId}/probe`, 'POST')).toHaveLength(
      1
    );
    expect(requests('/api/ai/settings')).toHaveLength(1);
    expect(mocks.models.refreshModels).toHaveBeenCalledTimes(1);
  });

  test.each(['download', 'probe'] as const)(
    'rejects duplicate and competing actions while a %s POST is pending',
    async action => {
      await mountSettings();
      const pending = Promise.withResolvers<Response>();
      fetchMock.mockImplementationOnce(() => pending.promise);
      const downloadButton = modelAction('Gemma 4 E2B', 'Download');
      const probeButton = modelAction('Qwen3.5 0.8B', 'Check model');
      const first = action === 'download' ? downloadButton : probeButton;
      const competing = action === 'download' ? probeButton : downloadButton;

      await act(async () => {
        fireEvent.click(first);
        fireEvent.click(first);
        fireEvent.click(competing);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      });
      expect(posts()).toHaveLength(1);
      expect(posts()[0][0]).toBe(
        `/v1/local/models/${action === 'download' ? gemmaId : qwenId}/${action}`
      );
      expect(mocks.notify.success).not.toHaveBeenCalled();

      await act(async () => {
        pending.resolve(
          Response.json(action === 'download' ? { download } : { probe }, {
            status: action === 'download' ? 409 : 200,
          })
        );
      });
      expect(posts()).toHaveLength(1);
    }
  );

  test('submits only one settings POST for repeated Save clicks', async () => {
    await mountSettings();
    const pending = Promise.withResolvers<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const save = screen.getByRole('button', { name: 'Save changes' });

    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });

    expect(posts()).toHaveLength(1);
    expect(requests('/api/ai/settings', 'POST')).toHaveLength(1);
    await act(async () => {
      pending.resolve(Response.json({ ok: true }));
    });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'AI settings saved',
    });
  });

  test.each(['queued', 'downloading', 'new download'] as const)(
    'polls a %s text download and refreshes the catalog exactly once on completion',
    async initialStatus => {
      if (initialStatus !== 'new download') {
        settings.meetings.localModels[0] = localModel(gemmaId, {
          downloadStatus: initialStatus,
          progress: 0.25,
        });
      }
      models = settings.meetings.localModels;
      await mountSettings();
      expect(mocks.models.refreshModels).toHaveBeenCalledTimes(1);
      expect(requests('/v1/local/models')).toHaveLength(0);
      if (initialStatus === 'new download') {
        download = { status: 'queued', message: '' };
        models = models.map(item =>
          item.id === gemmaId ? { ...item, downloadStatus: 'queued' } : item
        );
        await click(modelAction('Gemma 4 E2B', 'Download'));
      }
      const healthRequestsBeforePolling = requests('/v1/local/models').length;
      const callsBeforePolling = fetchMock.mock.calls.length;
      models = models.map(item =>
        item.id === gemmaId
          ? { ...item, downloadStatus: 'downloading', progress: 0.6 }
          : item
      );

      await refreshHealth('poll');

      expect(screen.getByRole('progressbar').getAttribute('value')).toBe('60');
      expect(mocks.models.refreshModels).toHaveBeenCalledTimes(1);
      models = models.map(item =>
        item.id === gemmaId
          ? { ...item, downloadStatus: 'downloaded', progress: 1 }
          : item
      );
      await refreshHealth('poll');

      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(
        within(screen.getByRole('listitem', { name: 'Gemma 4 E2B' })).getByText(
          'Downloaded - Not checked'
        )
      ).toBeTruthy();
      expect(mocks.models.refreshModels).toHaveBeenCalledTimes(2);
      expect(requests('/v1/local/models')).toHaveLength(
        healthRequestsBeforePolling + 2
      );
      await refreshHealth('poll');
      expect(requests('/v1/local/models')).toHaveLength(
        healthRequestsBeforePolling + 2
      );
      await refreshHealth('refresh');
      expect(mocks.models.refreshModels).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls
          .slice(callsBeforePolling)
          .map(([url, init]) => [url, init?.method ?? 'GET'])
      ).toEqual([
        ['/v1/local/models', 'GET'],
        ['/v1/local/models', 'GET'],
        ['/v1/local/models', 'GET'],
      ]);
      expect(requests('/api/ai/settings')).toHaveLength(1);
      expect(posts()).toHaveLength(initialStatus === 'new download' ? 1 : 0);
      expect(mocks.models.watchLocalModelDownload).not.toHaveBeenCalled();
    }
  );

  test('does not refresh the chat catalog for an embedding download completion', async () => {
    settings.meetings.localModels[2] = localModel(embeddingId, {
      type: 'embedding',
      downloadStatus: 'downloading',
    });
    models = settings.meetings.localModels;
    await mountSettings('embeddings');
    models = models.map(item =>
      item.id === embeddingId
        ? { ...item, downloadStatus: 'downloaded', progress: 1 }
        : item
    );

    await refreshHealth('poll');
    await refreshHealth('poll');

    expect(mocks.models.refreshModels).toHaveBeenCalledTimes(1);
    expect(requests('/api/ai/settings')).toHaveLength(1);
    expect(requests('/v1/local/models')).toHaveLength(1);
    expect(posts()).toHaveLength(0);
    expect(mocks.models.watchLocalModelDownload).not.toHaveBeenCalled();
  });

  test('aborts an active health poll and stops polling after unmount', async () => {
    settings.meetings.localModels[0] = localModel(gemmaId, {
      downloadStatus: 'downloading',
    });
    const view = await mountSettings();
    const pending = Promise.withResolvers<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    await refreshHealth('poll');
    const signal = requests('/v1/local/models')[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    view.unmount();

    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(Response.json({ models }));
    });
    await refreshHealth('poll');
    expect(requests('/v1/local/models')).toHaveLength(1);
    expect(mocks.notify.success).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });

  test('clears the managed ID for a local endpoint and rejects typing it back', async () => {
    await mountSettings();
    await click(screen.getByRole('menuitem', { name: 'Local endpoint' }));
    expect(fieldValue('Model ID')).toBe('');
    expect(fieldValue('Local endpoint')).toBe(settings.localBaseUrl);

    await click(screen.getByRole('button', { name: 'Save changes' }));
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toBe(
      'Enter a model ID before saving.'
    );
    fireEvent.change(screen.getByLabelText('Model ID'), {
      target: { value: gemmaId },
    });
    await click(screen.getByRole('button', { name: 'Save changes' }));

    expect(posts()).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toBe(
      'This model ID belongs to a managed local model. Select it from Chat model instead.'
    );
    expect(mocks.notify.error).toHaveBeenLastCalledWith({
      title:
        'This model ID belongs to a managed local model. Select it from Chat model instead.',
    });
    expect(mocks.notify.success).not.toHaveBeenCalled();
    expect(fieldValue('Model ID')).toBe(gemmaId);

    fireEvent.change(screen.getByLabelText('Model ID'), {
      target: { value: 'custom-endpoint-model' },
    });
    fireEvent.change(screen.getByLabelText('Local endpoint'), {
      target: { value: 'http://localhost:23456/v1' },
    });
    await click(screen.getByRole('button', { name: 'Save changes' }));
    expect(posts()).toHaveLength(1);
    expect(
      JSON.parse(requests('/api/ai/settings', 'POST')[0][1]?.body as string)
    ).toMatchObject({
      defaultProvider: 'local',
      defaultModel: 'custom-endpoint-model',
      localModel: 'custom-endpoint-model',
      localBaseUrl: 'http://localhost:23456/v1',
    });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'AI settings saved',
    });
  });

  test('saves only embedding and search fields in embeddings scope', async () => {
    await mountSettings('embeddings');
    expect(screen.getByRole('heading', { name: 'Embeddings' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Provider' })).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Image Generation' })
    ).toBeNull();
    expect(screen.queryByRole('heading', { name: 'MCP' })).toBeNull();
    await click(screen.getByRole('menuitem', { name: 'Force semantic' }));
    await click(screen.getByRole('menuitem', { name: alternateEmbeddingId }));
    await click(
      screen.getByRole('switch', { name: 'Automatic model downloads' })
    );
    await click(screen.getByRole('switch', { name: 'Workspace search' }));
    await click(screen.getByRole('switch', { name: 'Enable AI tools' }));

    await click(screen.getByRole('button', { name: 'Save changes' }));

    expect(posts()).toHaveLength(1);
    const save = requests('/api/ai/settings', 'POST')[0];
    expect(save[1]?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(save[1]?.body as string)).toEqual({
      toolsEnabled: false,
      embeddingAllowRemote: true,
      embeddingMode: 'semantic',
      embeddingModel: alternateEmbeddingId,
      workspaceSearchToolEnabled: false,
    });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'AI settings saved',
    });
    expect(mocks.notify.error).not.toHaveBeenCalled();
  });
});
