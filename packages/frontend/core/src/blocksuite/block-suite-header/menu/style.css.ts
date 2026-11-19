import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const shareMenu = style({
  padding: 4,
  width: '420px',
  // to handle overflow when the width is not enough
  maxWidth: 'calc(var(--radix-dropdown-menu-content-available-width) - 8px)',
});

export const fontStyleRow = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 4,
  padding: '4px 4px 6px',
});

export const fontStyleOption = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  padding: '6px 4px',
  borderRadius: 6,
  border: `1px solid transparent`,
  background: 'transparent',
  color: cssVarV2('text/secondary'),
  cursor: 'pointer',
  transition: 'background-color 0.15s ease, color 0.15s ease',
  selectors: {
    '&:hover:not(:disabled)': {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('text/primary'),
    },
    '&[data-active="true"]': {
      backgroundColor: cssVarV2('layer/background/secondary'),
      borderColor: cssVarV2('layer/insideBorder/border'),
      color: cssVarV2('button/primary'),
    },
    '&:disabled': {
      opacity: 0.45,
      cursor: 'default',
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: -1,
    },
  },
});

export const fontStyleSample = style({
  fontSize: 18,
  fontWeight: 600,
  lineHeight: '22px',
});

export const fontStyleSans = style({
  fontFamily: cssVar('fontSansFamily'),
});

export const fontStyleSerif = style({
  fontFamily: cssVar('fontSerifFamily'),
});

export const fontStyleMono = style({
  fontFamily: cssVar('fontMonoFamily'),
});

export const fontStyleLabel = style({
  fontSize: 11,
  lineHeight: '14px',
});
