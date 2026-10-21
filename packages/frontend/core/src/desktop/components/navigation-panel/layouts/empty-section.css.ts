import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const content = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  padding: '4px 8px 8px 28px',
  borderRadius: 6,
  selectors: {
    // assume that the section can be dragged over
    '&[data-dragged-over="true"]': {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});
export const iconWrapper = style({
  display: 'none',
});
export const icon = style({});
export const message = style({
  fontSize: 12,
  color: cssVarV2('text/tertiary'),
  userSelect: 'none',
  fontWeight: 400,
  lineHeight: '18px',
});

export const newButton = style({
  padding: '2px 8px',
  height: 24,
  fontSize: 12,
});
