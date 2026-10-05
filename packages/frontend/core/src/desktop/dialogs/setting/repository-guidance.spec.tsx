// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { IssueFeedbackModal } from './issue-feedback-modal';
import { StarNotaModal } from './star-nota-modal';

vi.mock('@nota/component', () => ({
  OverlayModal: ({
    description,
    to,
  }: {
    description: ReactNode;
    to: string;
  }) => (
    <div>
      {description}
      <a href={to}>Open GitHub</a>
    </div>
  ),
}));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));

afterEach(cleanup);

describe('repository guidance', () => {
  test('provides star instructions and retains the repository action', () => {
    const { container } = render(<StarNotaModal open setOpen={vi.fn()} />);
    expect(screen.getByText('Sign in to your GitHub account.')).toBeDefined();
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      BUILD_CONFIG.githubUrl
    );
    expect(container.querySelector('video')).toBeNull();
  });

  test('provides issue instructions and retains the issue form action', () => {
    const { container } = render(<IssueFeedbackModal open setOpen={vi.fn()} />);
    expect(
      screen.getByText(
        'Include your Nota version and steps to reproduce the issue.'
      )
    ).toBeDefined();
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      `${BUILD_CONFIG.githubUrl}/issues/new/choose`
    );
    expect(container.querySelector('video')).toBeNull();
  });
});
