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
  background: 'rgba(111, 127, 84, 0.08)',
  border: '1px solid rgba(111, 127, 84, 0.22)',
  borderRadius: '14px',
  fontSize: cssVar('fontSm'),
  // width: '100%',
  height: '36px',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(16, 24, 12, 0.08)',
  transition:
    'background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      background: 'rgba(111, 127, 84, 0.16)',
      borderColor: 'rgba(111, 127, 84, 0.34)',
      boxShadow: '0 6px 18px rgba(16, 24, 12, 0.12)',
      transform: 'translateY(-1px)',
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
  background: 'rgba(111, 127, 84, 0.24)',
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
