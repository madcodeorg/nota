import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const viewToggle = style({
  background: 'transparent',
});
export const viewToggleItem = style({
  padding: 0,
  fontSize: 16,
  width: 28,
  height: 28,
  color: cssVarV2.icon.secondary,
  borderRadius: 6,
  selectors: {
    '&[data-state=checked]': {
      color: cssVarV2.icon.primary,
    },
  },
});
export const viewToggleIndicator = style({
  backgroundColor: cssVarV2('layer/background/hoverOverlay'),
  borderRadius: 6,
});
