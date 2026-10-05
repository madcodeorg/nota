import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const groupHeader = style({
  background: 'transparent',
  borderRadius: 999,
  color: cssVarV2.text.secondary,
});

export const docItem = style({
  borderRadius: 24,
  transition: 'width 0.2s ease-in-out, transform .16s ease',
});
