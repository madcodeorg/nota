import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const button = style({
  ['WebkitAppRegion' as string]: 'no-drag',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 12px 0 10px',
  border: '1px solid transparent',
  borderRadius: 999,
  background: cssVar('hoverColor'),
  color: cssVar('textPrimaryColor'),
  cursor: 'pointer',
  flexShrink: 0,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  transition: 'background-color .16s ease, border-color .16s ease',
  selectors: {
    '&:hover:not(:disabled)': {
      background: 'var(--nota-sidebar-active)',
    },
    '&:disabled': { cursor: 'default' },
    '&[data-ready]': {
      background: 'var(--nota-solid-background)',
      color: 'var(--nota-solid-text)',
    },
    '&[data-ready]:hover:not(:disabled)': {
      background: 'var(--nota-solid-background-hover)',
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVar('primaryColor')}`,
      outlineOffset: 2,
    },
  },
});

export const icon = style({ width: 15, height: 15, flexShrink: 0 });

export const progress = style({
  width: 36,
  height: 4,
  borderRadius: 2,
  overflow: 'hidden',
  background: 'var(--nota-skeleton-base)',
});

export const progressFill = style({
  display: 'block',
  height: '100%',
  background: 'var(--nota-accent)',
  transition: 'width .2s ease',
});
