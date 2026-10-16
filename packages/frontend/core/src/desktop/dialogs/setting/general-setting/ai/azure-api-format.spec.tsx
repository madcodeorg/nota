// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type PropsWithChildren, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { AzureApiFormat } from './azure-api-format';

vi.mock('@nota/component', () => ({
  Menu: ({ items, children }: PropsWithChildren<{ items: ReactNode }>) => (
    <div>
      {children}
      {items}
    </div>
  ),
  MenuItem: ({
    onSelect,
    children,
    disabled,
  }: PropsWithChildren<{ onSelect: () => void; disabled?: boolean }>) => (
    <button disabled={disabled} onClick={onSelect}>
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
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
afterEach(cleanup);

test('defaults to Responses and emits the selected Azure API mode', () => {
  const onChange = vi.fn();
  render(<AzureApiFormat disabled={false} onChange={onChange} />);
  expect(screen.getByLabelText('API format').textContent).toBe('Responses');
  fireEvent.click(screen.getByText('Chat Completions'));
  expect(onChange).toHaveBeenLastCalledWith('chat');
  fireEvent.click(screen.getByText('DeepSeek'));
  expect(onChange).toHaveBeenLastCalledWith('deepseek');
});

test('shows a saved format and prevents changes while settings are disabled', () => {
  const onChange = vi.fn();
  render(<AzureApiFormat value="chat" disabled onChange={onChange} />);
  expect(screen.getByLabelText('API format').textContent).toBe(
    'Chat Completions'
  );
  fireEvent.click(screen.getByText('DeepSeek'));
  expect(onChange).not.toHaveBeenCalled();
});
