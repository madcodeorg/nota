import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const dropdownBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 12px',
  // fix dropdown button click area
  paddingRight: 0,
  color: cssVar('textPrimaryColor'),
  fontWeight: 600,
  background: 'var(--nota-row-background)',
  border: '1px solid transparent',
  borderRadius: 'var(--nota-control-radius, 8px)',
  fontSize: cssVar('fontSm'),
  // width: '100%',
  height: '36px',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition:
    'background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      background: cssVar('backgroundTertiaryColor'),
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&[data-size=default]': {
      height: 36,
    },
    '&[data-size=small]': {
      height: 32,
    },
  },
});

export const divider = style({
  width: '0.5px',
  height: '16px',
  background: cssVar('borderColor'),
  // fix dropdown button click area
  margin: '0 6px',
  marginRight: 0,
});

export const dropdownWrapper = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  paddingLeft: '4px',
  paddingRight: '12px',
});

export const dropdownIcon = style({
  borderRadius: '9px',
  selectors: {
    [`${dropdownWrapper}:hover &`]: {
      background: cssVar('hoverColor'),
    },
  },
});
