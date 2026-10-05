import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const viewToggle = style({
  background: 'rgba(111, 127, 84, 0.1)',
  border: '1px solid rgba(111, 127, 84, 0.16)',
  borderRadius: 16,
  boxShadow: '0 1px 2px rgba(16, 24, 12, 0.08)',
});
export const viewToggleItem = style({
  padding: 0,
  fontSize: 16,
  width: 30,
  height: 30,
  color: cssVarV2.icon.primary,
  borderRadius: 13,
  selectors: {
    '&[data-state=checked]': {
      color: '#b9c78c',
    },
  },
});
export const viewToggleIndicator = style({
  backgroundColor: 'rgba(111, 127, 84, 0.2)',
  borderRadius: 13,
  boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.24)',
});
