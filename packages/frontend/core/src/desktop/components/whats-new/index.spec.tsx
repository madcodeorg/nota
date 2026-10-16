// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openPopupWindow: vi.fn() }));
vi.mock('@nota/core/modules/url', () => ({ UrlService: class UrlService {} }));
vi.mock('@nota/component/ui/modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));
vi.mock('@nota/infra', () => ({
  useService: () => ({ openPopupWindow: mocks.openPopupWindow }),
}));

import { shouldShowWhatsNew, WhatsNewModal } from './index';

const SEEN_KEY = 'nota-whats-new:seen-version';
const original = { ...BUILD_CONFIG };

beforeEach(() => {
  localStorage.clear();
  Object.assign(BUILD_CONFIG, {
    isElectron: true,
    appVersion: '1.2.0',
    releaseNotes: ['Faster search', 'Meeting summaries'],
  });
});

afterEach(() => {
  cleanup();
  Object.assign(BUILD_CONFIG, original);
});

describe('shouldShowWhatsNew', () => {
  test('records a fresh install without showing', () => {
    expect(shouldShowWhatsNew()).toBe(false);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1.2.0');
  });

  test('shows once after an update', () => {
    localStorage.setItem(SEEN_KEY, '1.1.0');
    expect(shouldShowWhatsNew()).toBe(true);
    expect(shouldShowWhatsNew()).toBe(false);
  });

  test('waits for the setup wizard to close', () => {
    localStorage.setItem(SEEN_KEY, '1.1.0');
    localStorage.setItem(
      'nota-welcome:v1',
      JSON.stringify({ showSetup: true })
    );
    expect(shouldShowWhatsNew()).toBe(false);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1.1.0');
  });

  test('stays hidden without notes or outside the desktop app', () => {
    localStorage.setItem(SEEN_KEY, '1.1.0');
    Object.assign(BUILD_CONFIG, { releaseNotes: [] });
    expect(shouldShowWhatsNew()).toBe(false);
    Object.assign(BUILD_CONFIG, { releaseNotes: ['a'], isElectron: false });
    expect(shouldShowWhatsNew()).toBe(false);
  });
});

test('modal lists the notes and closes on Got it', async () => {
  localStorage.setItem(SEEN_KEY, '1.1.0');
  render(<WhatsNewModal />);
  expect(await screen.findByText('Faster search')).toBeTruthy();
  expect(screen.getByText('Meeting summaries')).toBeTruthy();
  expect(screen.getByText('Updated to version 1.2.0')).toBeTruthy();

  fireEvent.click(screen.getByText('Full release notes'));
  expect(mocks.openPopupWindow).toHaveBeenCalledWith(
    `${BUILD_CONFIG.githubUrl}/releases/tag/v1.2.0`
  );

  fireEvent.click(screen.getByTestId('whats-new-done'));
  expect(screen.queryByText('Faster search')).toBeNull();
});
