import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const menuContent = style({
  backgroundColor: cssVar('backgroundOverlayPanelColor'),
  borderRadius: 18,
  border: '1px solid rgba(111, 127, 84, 0.16)',
  boxShadow: '0 18px 46px rgba(16, 24, 12, 0.18)',
});
export const button = style({
  background: 'rgba(111, 127, 84, 0.1)',
  borderColor: 'rgba(111, 127, 84, 0.22)',
  color: cssVarV2.text.primary,
});
