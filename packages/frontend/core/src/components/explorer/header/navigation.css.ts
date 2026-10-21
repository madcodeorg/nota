import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  gap: 2,
  alignItems: 'center',
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 500,
});

export const item = style({
  color: cssVarV2.text.tertiary,
  height: 28,
  padding: '0 10px',
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'background-color .12s ease, color .12s ease',
  selectors: {
    '&:hover': {
      color: cssVarV2.text.primary,
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-active="true"]': {
      color: cssVarV2.text.primary,
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});
