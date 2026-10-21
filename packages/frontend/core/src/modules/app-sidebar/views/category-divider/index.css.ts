import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

const baseAction = style({
  display: 'flex',
  gap: 8,
  opacity: 0,
});

export const root = style({
  fontSize: 12,
  height: 26,
  width: '100%',
  userSelect: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 8px',
  borderRadius: 6,
  selectors: {
    [`&[data-collapsible="true"]`]: {
      cursor: 'pointer',
    },
    [`&[data-collapsible="true"]:hover`]: {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    },
    [`&[data-collapsible="true"]:hover:has(${baseAction}:hover)`]: {
      backgroundColor: 'transparent',
    },
  },
});

export const actions = style([
  baseAction,
  {
    selectors: {
      [`${root}:hover &`]: {
        opacity: 1,
      },
    },
  },
]);

export const label = style({
  color: cssVarV2('text/secondary'),
  fontWeight: 500,
  lineHeight: '20px',
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  cursor: 'pointer',
});

export const icon = style({
  display: 'flex',
  fontSize: 14,
  color: cssVarV2('icon/secondary'),
});

export const collapseIcon = style({
  marginLeft: -2,
  color: cssVarV2('icon/tertiary'),
  opacity: 0,
  transform: 'rotate(90deg)',
  transition: 'transform 0.16s ease, opacity 0.16s ease',
  selectors: {
    [`${root}:hover &`]: {
      opacity: 1,
    },
    [`${root}[data-collapsed="true"] &`]: {
      transform: 'rotate(0deg)',
      opacity: 1,
    },
  },
});
