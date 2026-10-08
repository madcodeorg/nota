// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { EdgelessSwitch } from '../steps/edgeless-switch';
import { articles } from './index';

vi.mock('@nota/component', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

afterEach(cleanup);

describe('original Nota onboarding examples', () => {
  test('preserves all selectable article IDs and matching previews', () => {
    expect(Object.keys(articles)).toEqual(['0', '1', '2', '3', '4']);
    for (const article of Object.values(articles)) {
      const { container, unmount } = render(
        <>
          {article.brief}
          {article.blocks[0].children}
        </>
      );
      const titles = container.querySelectorAll('h1');
      expect(titles).toHaveLength(2);
      expect(titles[0].textContent).toBe(titles[1].textContent);
      expect(article.enterOptions).toBeDefined();
      expect(article.initState).toBeDefined();
      unmount();
    }
  });

  test.each(Object.values(articles))(
    'keeps Page → Edgeless → completion working for example $id',
    article => {
      const onNext = vi.fn();
      const { container } = render(
        <EdgelessSwitch article={article} onNext={onNext} />
      );
      const canvas = container.querySelector<HTMLElement>('[data-mode="page"]');
      expect(canvas).not.toBeNull();
      expect(container.querySelector('img,video,iframe')).toBeNull();
      const aside = container.querySelector<HTMLElement>(
        '[data-invisible="true"]'
      );
      expect(aside).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(canvas?.dataset.mode).toBe('edgeless');
      expect(aside?.dataset.invisible).toBe('false');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(canvas?.dataset.mode).toBe('well-done');
      fireEvent.click(screen.getByRole('button', { name: 'Get Started' }));
      expect(onNext).toHaveBeenCalledOnce();
    }
  );
});
