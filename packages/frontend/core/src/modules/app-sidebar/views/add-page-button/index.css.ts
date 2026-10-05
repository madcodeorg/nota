import { cssVar } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  width: 24,
  height: 24,
  padding: 0,
  borderRadius: 6,
  boxShadow: 'none',
  border: 0,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color .16s ease, color .16s ease, opacity .16s ease',
  selectors: {
    '&:hover': {
      background: 'rgba(111, 127, 84, 0.14)',
    },
    '&:active': {
      background: 'rgba(111, 127, 84, 0.2)',
    },
  },
});

globalStyle(`${root} svg`, {
  color: cssVar('textSecondaryColor'),
});

globalStyle(`${root}:hover svg`, {
  color: cssVar('textPrimaryColor'),
});

export const withAskRoot = style([
  root,
  {
    width: 34,
    padding: '0 5px',
  },
]);

export const withAskContent = style({
  fontSize: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  color: 'inherit',
});

export const templateMenu = style({
  width: 280,
});
