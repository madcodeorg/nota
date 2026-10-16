// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type PropsWithChildren, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { ProviderModelDiscovery } from './provider-model-discovery';

vi.mock('@nota/component', () => ({
  Button: ({
    children,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Menu: ({ items, children }: PropsWithChildren<{ items: ReactNode }>) => (
    <div>
      {children}
      {items}
    </div>
  ),
  MenuItem: ({
    onSelect,
    children,
  }: PropsWithChildren<{ onSelect: () => void }>) => (
    <button onClick={onSelect}>{children}</button>
  ),
  MenuTrigger: ({
    children,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@nota/component/setting-components', () => ({
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('only discovers when requested and preserves provider model IDs', async () => {
  const fetcher = vi.fn(async (_url: string) => ({
    ok: true,
    json: async () => ({
      models: [{ id: 'vendor/model:variant', name: 'Vendor model' }],
    }),
  }));
  vi.stubGlobal('fetch', fetcher);
  const onModelChange = vi.fn();
  render(
    <ProviderModelDiscovery
      provider="ai-gateway"
      disabled={false}
      onModelChange={onModelChange}
    />
  );
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText('Discover models'));
  });
  await waitFor(() => expect(screen.getByText('Vendor model')).toBeTruthy());
  expect(fetcher.mock.calls[0][0]).toBe('/api/ai/providers/ai-gateway/models');
  fireEvent.click(screen.getByText('Vendor model'));
  expect(onModelChange).toHaveBeenCalledWith('vendor/model:variant');
});

test('keeps manual entry available when a catalog is unsupported', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Catalog unavailable' }),
    }))
  );
  render(
    <ProviderModelDiscovery
      provider="cohere"
      disabled={false}
      onModelChange={vi.fn()}
    />
  );
  await act(async () => {
    fireEvent.click(screen.getByText('Discover models'));
  });
  expect(screen.getByRole('status').textContent).toContain(
    'enter a model ID manually'
  );
});
