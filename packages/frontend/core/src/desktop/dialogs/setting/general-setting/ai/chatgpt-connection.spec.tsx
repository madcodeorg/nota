// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  ChatGPTConnection,
  type ChatGPTStatus,
  validatedChatGPTAuthUrl,
} from './chatgpt-connection';

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
  Menu: ({
    items,
    children,
  }: PropsWithChildren<{ items: React.ReactNode }>) => (
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
    spreadCol,
    className,
  }: PropsWithChildren<{
    name: string;
    desc?: string;
    spreadCol?: boolean;
    className?: string;
  }>) => (
    <div
      data-layout={spreadCol === false ? 'stacked' : 'standard'}
      className={className}
    >
      <label>{name}</label>
      <span>{desc}</span>
      {children}
    </div>
  ),
}));

const disconnected: ChatGPTStatus = {
  connected: false,
  planEnabled: false,
  pending: false,
  profiles: [],
};
let status: ChatGPTStatus;
let authUrl: string;
let catalogFailure: string | null;
type MockFetch = (
  url: string,
  init?: RequestInit
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
let fetchMock: ReturnType<typeof vi.fn<MockFetch>>;
const openExternal = vi.fn();
const onModelsChanged = vi.fn(async () => {});
const onModelChange = vi.fn();

beforeEach(() => {
  status = { ...disconnected };
  catalogFailure = null;
  authUrl = 'https://auth.openai.com/oauth/authorize?state=test';
  openExternal.mockClear();
  onModelsChanged.mockClear();
  onModelChange.mockClear();
  fetchMock = vi.fn<MockFetch>(async (url: string, init?: RequestInit) => {
    const route = url.split('/').at(-1);
    if (route === 'sign-in') {
      status = { ...status, pending: true };
      return { ok: true, json: async () => ({ url: authUrl }) };
    }
    if (route === 'cancel') status = { ...status, pending: false };
    if (route === 'disconnect') status = { ...disconnected };
    if (route === 'select-profile')
      status = {
        ...status,
        activeProfileId: JSON.parse(init?.body as string).profileId,
      };
    if (route === 'models' && catalogFailure)
      return { ok: false, json: async () => ({ error: catalogFailure }) };
    return {
      ok: true,
      json: async () =>
        route === 'models'
          ? { models: [{ id: 'gpt-next', name: 'GPT Next' }] }
          : status,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <ChatGPTConnection
      disabled={false}
      openExternal={openExternal}
      onModelsChanged={onModelsChanged}
      model="manual-id"
      onModelChange={onModelChange}
    />
  );
}
function calls(route: string) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith(`/${route}`)
  );
}
async function ready() {
  mount();
  await waitFor(() => expect(calls('status')).toHaveLength(1));
  await act(async () => {});
}

describe('ChatGPT connection', () => {
  test('opens validated browser login, polls only pending, and stops after connection', async () => {
    await ready();
    expect(calls('models')).toHaveLength(0);
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('Continue with ChatGPT'));
    });
    expect(openExternal).toHaveBeenCalledWith(authUrl);
    expect(screen.getByText('Cancel sign-in')).toBeTruthy();
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [
        { id: 'one', name: 'Account one', connected: true, planEnabled: true },
      ],
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      screen.getByText('ChatGPT plan connected. Subscription limits apply.')
    ).toBeTruthy();
    expect(calls('models')).toHaveLength(1);
    expect(onModelsChanged).toHaveBeenCalled();
    const count = calls('status').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(calls('status')).toHaveLength(count);
    expect(onModelChange).not.toHaveBeenCalled();
    expect(calls('settings')).toHaveLength(0);
  });

  test('offers only models from the signed-in account catalog', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    await ready();
    await waitFor(() => expect(screen.getByText('GPT Next')).toBeTruthy());
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(screen.getAllByLabelText('ChatGPT models')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByText('GPT Next'));
    });
    expect(onModelChange).toHaveBeenCalledWith('gpt-next');
  });

  test('keeps the model picker disabled when the catalog is unavailable', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      profiles: [],
    };
    catalogFailure = 'ChatGPT models are temporarily unavailable (HTTP 520).';
    await ready();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(catalogFailure)
    );
    expect(screen.getByLabelText('ChatGPT models')).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(screen.getByText('Refresh models')).toHaveProperty(
      'disabled',
      false
    );
    expect(onModelChange).not.toHaveBeenCalled();
  });

  test('successful catalog recovery clears the backend status warning too', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      profiles: [],
      error: 'ChatGPT model catalog is unavailable (OpenAI HTTP 520).',
    };
    catalogFailure = status.error ?? null;
    await ready();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(status.error)
    );
    catalogFailure = null;
    await act(async () => {
      fireEvent.click(screen.getByText('Refresh models'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('GPT Next')).toBeTruthy();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  test('unmount stops pending status polling', async () => {
    const view = mount();
    await act(async () => {});
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('Continue with ChatGPT'));
    });
    view.unmount();
    const count = calls('status').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(calls('status')).toHaveLength(count);
  });

  test('cancel sign-in stops pending state without requiring an API key', async () => {
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByText('Continue with ChatGPT'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel sign-in'));
    });
    expect(calls('cancel')).toHaveLength(1);
    expect(screen.queryByText('Cancel sign-in')).toBeNull();
    expect(screen.queryByLabelText(/API key/)).toBeNull();
  });

  test('switches profile, adds another account, and disconnects the selected account', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [
        {
          id: 'one',
          name: 'First account',
          connected: true,
          planEnabled: true,
        },
        {
          id: 'two',
          name: 'Second account',
          connected: true,
          planEnabled: true,
        },
      ],
    };
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByText('Second account'));
    });
    expect(JSON.parse(calls('select-profile')[0][1]?.body as string)).toEqual({
      profileId: 'two',
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Manage usage'));
    });
    expect(openExternal).toHaveBeenCalledWith(
      'https://chatgpt.com/settings/usage'
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Disconnect'));
    });
    expect(calls('disconnect')).toHaveLength(1);
    expect(screen.queryByText('Disconnect')).toBeNull();
  });

  test('shows catalog failure and retries without changing the selected model', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    catalogFailure = 'Catalog temporarily unavailable';
    await ready();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Catalog temporarily unavailable'
      )
    );
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
    catalogFailure = null;
    await act(async () => {
      fireEvent.click(screen.getByText('Refresh models'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('GPT Next')).toBeTruthy();
    expect(calls('models')).toHaveLength(2);
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  test('can show account login without model controls and reports connection/catalog without selecting a model', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    const onStatusChange = vi.fn();
    const onCatalogChange = vi.fn();
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        showModelSettings={false}
        onStatusChange={onStatusChange}
        onCatalogChange={onCatalogChange}
      />
    );
    await waitFor(() =>
      expect(onCatalogChange).toHaveBeenLastCalledWith([
        { id: 'gpt-next', name: 'GPT Next' },
      ])
    );
    expect(onStatusChange).toHaveBeenLastCalledWith(status);
    expect(screen.getByText('Continue with ChatGPT')).toBeTruthy();
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(screen.queryByText('Refresh models')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('Disconnect'));
    });
    expect(onCatalogChange).toHaveBeenLastCalledWith([]);
    expect(onStatusChange).toHaveBeenLastCalledWith(disconnected);
  });

  test('collapsed account controls keep verified models available without showing management actions', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [
        { id: 'one', name: 'Account One', connected: true, planEnabled: true },
      ],
    };
    const onCatalogChange = vi.fn();
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        showModelSettings={false}
        collapseAccountControls
        onCatalogChange={onCatalogChange}
      />
    );
    await waitFor(() =>
      expect(onCatalogChange).toHaveBeenLastCalledWith([
        { id: 'gpt-next', name: 'GPT Next' },
      ])
    );
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Continue with ChatGPT' })
    ).toBeNull();
    const summary = screen.getByText('Manage account');
    const details = summary.closest('details');
    if (!details) throw new Error('Missing account disclosure.');
    expect(summary.tagName).toBe('SUMMARY');
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    await act(async () => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
    });
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(onCatalogChange).toHaveBeenLastCalledWith([
      { id: 'gpt-next', name: 'GPT Next' },
    ]);
    expect(calls('models')).toHaveLength(1);
    expect(onModelChange).not.toHaveBeenCalled();
  });

  test('catalog failures remain visible and recoverable without opening account controls or selecting ChatGPT', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      profiles: [],
    };
    catalogFailure = 'Catalog is temporarily unavailable.';
    const onCatalogChange = vi.fn();
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        showModelSettings={false}
        collapseAccountControls
        onCatalogChange={onCatalogChange}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(catalogFailure)
    );
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    catalogFailure = null;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    });
    expect(onCatalogChange).toHaveBeenLastCalledWith([
      { id: 'gpt-next', name: 'GPT Next' },
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  test('collapsed account controls keep login and pending cancellation visible', async () => {
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        showModelSettings={false}
        collapseAccountControls
      />
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue with ChatGPT' })
      );
    });
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
    expect(screen.queryByText('Manage account')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    });
    expect(
      screen.getByRole('button', { name: 'Continue with ChatGPT' })
    ).toBeTruthy();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  test('does not expose a stale previous-profile catalog while the next account loads', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [
        {
          id: 'one',
          name: 'First account',
          connected: true,
          planEnabled: true,
        },
        {
          id: 'two',
          name: 'Second account',
          connected: true,
          planEnabled: true,
        },
      ],
    };
    const onCatalogChange = vi.fn();
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        onCatalogChange={onCatalogChange}
      />
    );
    await waitFor(() =>
      expect(onCatalogChange).toHaveBeenLastCalledWith([
        { id: 'gpt-next', name: 'GPT Next' },
      ])
    );
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return new Promise<never>(() => {});
      if (url.endsWith('/select-profile'))
        status = {
          ...status,
          activeProfileId: JSON.parse(init?.body as string).profileId,
        };
      return Promise.resolve({ ok: true, json: async () => status });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Second account'));
    });
    expect(onCatalogChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText('GPT Next')).toBeNull();
  });

  test('compact onboarding layout stacks rows and keeps account controls in a wrapping group', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    render(
      <ChatGPTConnection
        compact
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
      />
    );
    await waitFor(() => expect(screen.getByText('Disconnect')).toBeTruthy());
    expect(
      screen.getByText('ChatGPT account').parentElement?.dataset.layout
    ).toBe('stacked');
    expect(screen.getByText('Connection').parentElement?.dataset.layout).toBe(
      'stacked'
    );
    const group = screen.getByText('Disconnect').parentElement;
    expect(group?.className).toContain('chatgptCompactActions');
    expect(group).toBe(screen.getByText('Manage usage').parentElement);
  });

  test('expired authentication during catalog refresh clears exposed models and connection status', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    const onStatusChange = vi.fn();
    const onCatalogChange = vi.fn();
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        onStatusChange={onStatusChange}
        onCatalogChange={onCatalogChange}
      />
    );
    await waitFor(() =>
      expect(onCatalogChange).toHaveBeenLastCalledWith([
        { id: 'gpt-next', name: 'GPT Next' },
      ])
    );
    catalogFailure = 'Authentication expired';
    status = { ...disconnected };
    await act(async () => {
      fireEvent.click(screen.getByText('Refresh models'));
    });
    expect(onCatalogChange).toHaveBeenLastCalledWith([]);
    expect(onStatusChange).toHaveBeenLastCalledWith(disconnected);
    expect(screen.queryByLabelText('Model ID')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.queryByText('GPT Next')).toBeNull();
  });

  test('stale failed-catalog status recovery cannot overwrite a new browser sign-in', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [],
    };
    const onStatusChange = vi.fn();
    render(
      <ChatGPTConnection
        disabled={false}
        openExternal={openExternal}
        onModelsChanged={onModelsChanged}
        model="manual-id"
        onModelChange={onModelChange}
        onStatusChange={onStatusChange}
      />
    );
    await waitFor(() => expect(screen.getByText('GPT Next')).toBeTruthy());
    let resolveRecovery!: (response: Awaited<ReturnType<MockFetch>>) => void;
    const recovery = new Promise<Awaited<ReturnType<MockFetch>>>(resolve => {
      resolveRecovery = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/models'))
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Authentication expired' }),
        });
      if (url.endsWith('/status')) return recovery;
      if (url.endsWith('/sign-in'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ url: authUrl }),
        });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Refresh models'));
    });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByText('Continue with ChatGPT'));
      for (let i = 0; i < 10 && !openExternal.mock.calls.length; i++)
        await Promise.resolve();
      expect(openExternal).toHaveBeenCalledOnce();
      resolveRecovery({ ok: true, json: async () => disconnected });
    });
    expect(screen.getByText('Cancel sign-in')).toBeTruthy();
    expect(onStatusChange.mock.calls.at(-1)?.[0].pending).toBe(true);
    const statusCalls = calls('status').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(calls('status').length).toBeGreaterThan(statusCalls);
  });

  test('add account opens a separate profile sign-in', async () => {
    status = {
      connected: true,
      planEnabled: true,
      pending: false,
      activeProfileId: 'one',
      profiles: [
        {
          id: 'one',
          name: 'First account',
          connected: true,
          planEnabled: true,
        },
      ],
    };
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByText('Add account'));
    });
    expect(JSON.parse(calls('sign-in')[0][1]?.body as string)).toEqual({
      newProfile: true,
    });
  });

  test('rejects auth URLs outside OpenAI without opening them', async () => {
    authUrl = 'https://auth.openai.com.attacker.example/oauth';
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByText('Continue with ChatGPT'));
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to open a valid ChatGPT sign-in URL. Try signing in again.'
    );
    expect(calls('cancel')).toHaveLength(1);
  });

  test('unavailable backend is an actionable local state', async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        json: async () => ({ error: 'Not found' }),
      })
    );
    mount();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'unavailable in this backend'
      )
    );
  });
});

test.each([
  'http://auth.openai.com/oauth',
  'https://auth.openai.com:8443/oauth',
  'https://other.example',
  'https://user@auth.openai.com/oauth',
  'javascript:alert(1)',
])('rejects unsafe auth URL %s', value => {
  expect(() => validatedChatGPTAuthUrl(value)).toThrow();
});
