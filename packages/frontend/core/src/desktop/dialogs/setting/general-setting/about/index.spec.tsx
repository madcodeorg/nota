// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AboutAffine } from './index';

vi.mock('@nota/component/setting-components', () => ({
  SettingHeader: () => null,
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingWrapper: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@nota/core/utils/channel', () => ({
  appIconMap: { canary: 'nota.svg' },
  appNames: { canary: 'Nota' },
}));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));

afterEach(cleanup);

describe('Nota project and legal links', () => {
  it('opens Nota source, support, and published legal documents on GitHub', () => {
    render(<AboutAffine />);
    expect(
      screen.getAllByRole('link').map(link => link.getAttribute('href'))
    ).toEqual([
      'https://github.com/madcodeorg/nota',
      'https://github.com/madcodeorg/nota/issues',
      'https://github.com/madcodeorg/nota/blob/main/docs/PRIVACY.md',
      'https://github.com/madcodeorg/nota/blob/main/docs/TERMS.md',
    ]);
  });
});
