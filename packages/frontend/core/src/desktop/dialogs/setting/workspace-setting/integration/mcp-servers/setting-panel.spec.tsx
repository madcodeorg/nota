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

const mocks = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn() },
  confirm: vi.fn(),
  url: { openExternal: vi.fn() },
}));

vi.mock('@blocksuite/icons/rc', () => ({
  CloseIcon: () => null,
  PlusIcon: () => null,
  WarningIcon: () => null,
}));
vi.mock('@nota/core/modules/url', () => ({ UrlService: Symbol('UrlService') }));
vi.mock('@nota/infra', () => ({ useService: () => mocks.url }));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@nota/component', () => {
  const Button = ({
    children,
    loading,
    disabled,
    variant: _variant,
    prefix: _prefix,
    size: _size,
    ...props
  }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'prefix'> & {
    loading?: boolean;
    variant?: string;
    prefix?: ReactNode;
    size?: string;
  }) => (
    <button {...props} disabled={disabled || loading}>
      {children}
    </button>
  );
  return {
    Button,
    IconButton: Button,
    MenuTrigger: Button,
    Menu: ({ children, items }: { children: ReactNode; items: ReactNode }) => (
      <div>
        {children}
        <div role="menu">{items}</div>
      </div>
    ),
    MenuItem: ({
      children,
      onSelect,
      selected: _selected,
    }: {
      children: ReactNode;
      onSelect: () => void;
      selected?: boolean;
    }) => (
      <button role="menuitem" onClick={onSelect}>
        {children}
      </button>
    ),
    Modal: ({
      open,
      title,
      children,
    }: {
      open: boolean;
      title: string;
      children: ReactNode;
    }) =>
      open ? (
        <div role="dialog" aria-label={title}>
          {children}
        </div>
      ) : null,
    RadioGroup: ({
      items,
      value,
      onChange,
    }: {
      items: Array<{ value: string; label: string }>;
      value: string;
      onChange: (value: string) => void;
    }) => (
      <div role="radiogroup">
        {items.map(item => (
          <button
            key={item.value}
            role="radio"
            aria-checked={item.value === value}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    ),
    Checkbox: ({
      checked,
      label,
      onChange,
    }: {
      checked: boolean;
      label: string;
      onChange: (event: unknown, checked: boolean) => void;
    }) => (
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={event => onChange(event, event.currentTarget.checked)}
      />
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
    ErrorMessage: ({ children }: { children: ReactNode }) => (
      <div role="alert">{children}</div>
    ),
    Skeleton: () => <div>Loading</div>,
    notify: mocks.notify,
    useConfirmModal: () => ({ openConfirmModal: mocks.confirm }),
  };
});

import type { McpServerView } from './api';
import { draftFromServer, emptyDraft } from './api';
import { McpServerDialog } from './server-dialog';
import { McpServersSettingPanel } from './setting-panel';

const fetchMock = vi.fn<typeof fetch>();
let toolsEnabled: boolean;
let servers: McpServerView[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const savedServer: McpServerView = {
  name: 'saved',
  enabled: true,
  connection: { type: 'http', url: 'https://saved.example.com', headers: [] },
  auth: { type: 'none' },
  status: { state: 'ready', toolNames: [], blockedToolNames: [] },
};

function route(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  const method = init?.method ?? 'GET';
  if (url === '/api/ai/mcp/servers' && method === 'GET')
    return json({ enabled: true, toolsEnabled, servers });
  if (url === '/api/ai/mcp/servers' && method === 'POST')
    return json({ server: savedServer });
  if (url.endsWith('/oauth/start'))
    return json({ url: 'https://auth.example.com/authorize?x=1' });
  if (method === 'DELETE' || url.endsWith('/oauth/disconnect'))
    return new Response(null, { status: 204 });
  if (url === '/api/ai/settings') return json({});
  return json({ error: `unexpected ${method} ${url}` }, 500);
}

const calls = (method: string, url?: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      (init?.method ?? 'GET') === method && (!url || String(input) === url)
  );
const bodyOf = (call: Parameters<typeof fetch>) =>
  JSON.parse(call[1]?.body as string);

async function mount() {
  await act(async () => {
    render(<McpServersSettingPanel />);
  });
}

beforeEach(() => {
  toolsEnabled = true;
  servers = [
    {
      name: 'my files',
      enabled: true,
      connection: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'files'],
        env: [],
      },
      auth: { type: 'none' },
      status: {
        state: 'gated',
        toolNames: ['read'],
        blockedToolNames: ['write'],
      },
    },
    {
      name: 'github',
      description: 'Code hosting',
      enabled: true,
      connection: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: [{ name: 'X-Key', hasValue: true }],
      },
      auth: { type: 'oauth', hasClientSecret: false, connected: false },
      status: { state: 'auth-required', toolNames: [], blockedToolNames: [] },
    },
    {
      name: 'broken',
      enabled: true,
      connection: {
        type: 'sse',
        url: 'https://b.example.com/sse',
        headers: [],
      },
      auth: { type: 'bearer', hasToken: true },
      status: {
        state: 'error',
        error: 'Connection refused',
        toolNames: [],
        blockedToolNames: [],
      },
    },
  ];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => route(input, init));
  vi.stubGlobal('fetch', fetchMock);
  mocks.notify.success.mockReset();
  mocks.notify.error.mockReset();
  mocks.url.openExternal.mockReset();
  mocks.confirm.mockReset();
  mocks.confirm.mockImplementation(
    (props: { onConfirm: () => Promise<void> }) => props.onConfirm()
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('McpServersSettingPanel', () => {
  test('lists servers with status pills and details', async () => {
    await mount();
    expect(screen.getByText('my files')).toBeTruthy();
    expect(screen.getByText('Gated')).toBeTruthy();
    expect(screen.getByText('1 write tool needs approval')).toBeTruthy();
    expect(screen.getByText('Local command · npx -y files')).toBeTruthy();
    expect(screen.getByText('Sign-in required')).toBeTruthy();
    expect(screen.getByText('Code hosting')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Connection refused')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByText(/mcpServers/)).toBeNull();
  });

  test('shows an empty state', async () => {
    servers = [];
    await mount();
    expect(screen.getByText(/No servers yet/)).toBeTruthy();
  });

  test('remove confirms and calls DELETE with an encoded name', async () => {
    await mount();
    const row = screen.getByText('my files').closest('li') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(calls('DELETE', '/api/ai/mcp/servers/my%20files')).toHaveLength(1);
  });

  test('master switch posts mcpEnabled', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('switch', { name: 'Enable MCP servers' })
      );
    });
    expect(bodyOf(calls('POST', '/api/ai/settings')[0])).toEqual({
      mcpEnabled: false,
    });
  });

  test('server switch re-saves the server without secrets', async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Enable broken' }));
    });
    expect(bodyOf(calls('POST', '/api/ai/mcp/servers')[0])).toEqual({
      originalName: 'broken',
      name: 'broken',
      description: '',
      icon: '',
      enabled: false,
      connection: {
        type: 'sse',
        url: 'https://b.example.com/sse',
        headers: [],
      },
      auth: { type: 'bearer' },
    });
  });

  test('connect opens the sign-in URL and polls until connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(
      calls('POST', '/api/ai/mcp/servers/github/oauth/start')
    ).toHaveLength(1);
    expect(mocks.url.openExternal).toHaveBeenCalledWith(
      'https://auth.example.com/authorize?x=1'
    );
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
    servers[1] = {
      ...servers[1],
      auth: { type: 'oauth', hasClientSecret: false, connected: true },
      status: { state: 'ready', toolNames: ['search'], blockedToolNames: [] },
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.notify.success).toHaveBeenCalledWith({
      title: 'Connected to github',
    });
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  test('featured Add opens a prefilled dialog', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add GitHub' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Add custom MCP server',
    });
    expect(
      (within(dialog).getByLabelText('Name') as HTMLInputElement).value
    ).toBe('GitHub');
    expect(
      (within(dialog).getByLabelText('Server URL') as HTMLInputElement).value
    ).toBe('https://api.githubcopilot.com/mcp/');
    expect(
      within(dialog).getByRole('button', { name: 'Authentication' }).textContent
    ).toBe('API key (Bearer token)');
  });

  test('featured OAuth servers prefill OAuth', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Linear' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Add custom MCP server',
    });
    expect(
      within(dialog).getByRole('button', { name: 'Authentication' }).textContent
    ).toBe('OAuth');
  });

  test('disables controls when AI tools are off', async () => {
    toolsEnabled = false;
    await mount();
    expect(screen.getByText(/Turn on AI tools/)).toBeTruthy();
    const master = screen.getByRole('switch', { name: 'Enable MCP servers' });
    expect((master as HTMLInputElement).disabled).toBe(true);
    const add = screen.getByRole('button', { name: 'Add server' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('McpServerDialog', () => {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  function open(initial = emptyDraft(), existingNames: string[] = []) {
    onSaved.mockReset();
    render(
      <McpServerDialog
        initial={initial}
        existingNames={existingNames}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const submitButton = (name = 'Add server') =>
    screen.getByRole('button', { name }) as HTMLButtonElement;
  const understand = () =>
    fireEvent.click(screen.getByLabelText('I understand and want to continue'));

  test('submit stays disabled until fields are valid and risk is accepted', () => {
    open();
    expect(submitButton().disabled).toBe(true);
    understand();
    expect(submitButton().disabled).toBe(true);
    type('Name', '-bad');
    expect(screen.getByText(/starting with a letter or number/)).toBeTruthy();
    type('Name', 'Weather');
    expect(submitButton().disabled).toBe(true);
    type('Server URL', 'https://weather.example.com/mcp');
    expect(submitButton().disabled).toBe(false);
    understand();
    expect(submitButton().disabled).toBe(true);
  });

  test('adds a remote server with a bearer token', async () => {
    open();
    type('Name', 'Weather');
    type('Description', 'Forecasts');
    type('Server URL', 'https://weather.example.com/mcp');
    fireEvent.click(screen.getByRole('menuitem', { name: 'SSE (legacy)' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'API key (Bearer token)' })
    );
    understand();
    expect(submitButton().disabled).toBe(true);
    type('API key', ' secret ');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(bodyOf(calls('POST', '/api/ai/mcp/servers')[0])).toEqual({
      name: 'Weather',
      description: 'Forecasts',
      icon: '',
      enabled: true,
      connection: {
        type: 'sse',
        url: 'https://weather.example.com/mcp',
        headers: [],
      },
      auth: { type: 'bearer', token: 'secret' },
    });
    expect(onSaved).toHaveBeenCalledWith(savedServer);
  });

  test('adds a local command server', async () => {
    open();
    type('Name', 'files');
    fireEvent.click(screen.getByRole('radio', { name: 'Local command' }));
    expect(
      screen.getByText(
        'Local commands use environment variables for credentials.'
      )
    ).toBeTruthy();
    type('Command', 'npx');
    type('Arguments', '-y\n@scope/server\n\n /tmp ');
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    type('variable name', 'TOKEN');
    understand();
    expect(submitButton().disabled).toBe(true);
    type('variable value', 'abc');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(bodyOf(calls('POST', '/api/ai/mcp/servers')[0])).toEqual({
      name: 'files',
      description: '',
      icon: '',
      enabled: true,
      connection: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@scope/server', '/tmp'],
        env: [{ name: 'TOKEN', value: 'abc' }],
      },
      auth: { type: 'none' },
    });
  });

  test('editing with blank secrets keeps them', async () => {
    open(
      draftFromServer({
        name: 'broken',
        enabled: false,
        connection: {
          type: 'http',
          url: 'https://b.example.com/mcp',
          headers: [{ name: 'X-Key', hasValue: true }],
        },
        auth: { type: 'bearer', hasToken: true },
        status: { state: 'disabled', toolNames: [], blockedToolNames: [] },
      }),
      ['broken']
    );
    expect(
      screen.getByRole('dialog', { name: 'Edit MCP server' })
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('API key') as HTMLInputElement).placeholder
    ).toBe('Saved — leave blank to keep');
    expect(submitButton('Save changes').disabled).toBe(true);
    understand();
    await act(async () => {
      fireEvent.click(submitButton('Save changes'));
    });
    expect(bodyOf(calls('POST', '/api/ai/mcp/servers')[0])).toEqual({
      originalName: 'broken',
      name: 'broken',
      description: '',
      icon: '',
      enabled: false,
      connection: {
        type: 'http',
        url: 'https://b.example.com/mcp',
        headers: [{ name: 'X-Key' }],
      },
      auth: { type: 'bearer' },
    });
  });

  test('rejects duplicate names', () => {
    open({ ...emptyDraft(), name: 'github' }, ['github']);
    expect(
      screen.getByText('A server with this name already exists.')
    ).toBeTruthy();
  });

  test('rejects icons that are too large or not PNG', () => {
    open();
    const input = screen.getByLabelText('Upload icon');
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(11 * 1024)], 'big.png', {
            type: 'image/png',
          }),
        ],
      },
    });
    expect(screen.getByText('The icon must be 10 KB or smaller.')).toBeTruthy();
    fireEvent.change(input, {
      target: {
        files: [new File(['x'], 'icon.jpg', { type: 'image/jpeg' })],
      },
    });
    expect(screen.getByText('Choose a PNG image.')).toBeTruthy();
  });

  test('shows backend errors inline', async () => {
    fetchMock.mockImplementation(async () =>
      json({ error: 'Server name is taken' }, 400)
    );
    open({ ...emptyDraft(), name: 'x', url: 'https://x.example.com' });
    understand();
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(screen.getByRole('alert').textContent).toBe('Server name is taken');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
