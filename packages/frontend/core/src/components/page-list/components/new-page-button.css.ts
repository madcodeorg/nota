import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';
export const menuContent = style({
  backgroundColor: cssVar('backgroundOverlayPanelColor'),
  borderRadius: 12,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  boxShadow: cssVar('menuShadow'),
});
export const button = style({
  borderRadius: 'var(--nota-control-radius)',
  background: 'var(--nota-row-background)',
  borderColor: cssVarV2.layer.insideBorder.border,
  color: cssVarV2.text.primary,
});
