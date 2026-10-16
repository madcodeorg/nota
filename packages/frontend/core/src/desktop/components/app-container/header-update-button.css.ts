import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

const green = '111, 127, 84';

export const button = style({
  ['WebkitAppRegion' as string]: 'no-drag',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 12px 0 10px',
  border: `1px solid rgba(${green}, 0.28)`,
  borderRadius: 999,
  background: `rgba(${green}, 0.12)`,
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
      background: `rgba(${green}, 0.2)`,
      borderColor: `rgba(${green}, 0.4)`,
    },
    '&:disabled': { cursor: 'default' },
    '&[data-ready]': {
      background: '#6f7f54',
      borderColor: '#6f7f54',
      color: '#fff',
    },
    '&[data-ready]:hover:not(:disabled)': { background: '#5f6e47' },
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
  background: `rgba(${green}, 0.2)`,
});

export const progressFill = style({
  display: 'block',
  height: '100%',
  background: '#6f7f54',
  transition: 'width .2s ease',
});
