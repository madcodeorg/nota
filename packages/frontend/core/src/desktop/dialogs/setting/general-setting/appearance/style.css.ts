import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const settingWrapper = style({
  flexGrow: 1,
  display: 'flex',
  justifyContent: 'flex-end',
  minWidth: '150px',
  maxWidth: '250px',
});

export const accentOptions = style({
  display: 'flex',
  gap: 10,
});

export const accentSwatch = style({
  width: 24,
  height: 24,
  padding: 0,
  border: 0,
  borderRadius: '50%',
  cursor: 'pointer',
  outlineOffset: 2,
  transition: 'transform .12s ease',
  selectors: {
    '&:hover': {
      transform: 'scale(1.08)',
    },
    '&[data-selected="true"]': {
      outline: `2px solid ${cssVarV2('text/primary')}`,
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('text/primary')}`,
    },
  },
});
