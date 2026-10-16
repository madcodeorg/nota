import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const eyebrow = style({
  display: 'inline-flex',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 500,
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
});

export const title = style({
  margin: '12px 0 4px',
  fontSize: 22,
  fontWeight: 600,
  fontFamily: "var(--affine-font-serif-family, 'Lora', serif)",
  color: cssVarV2('text/primary'),
});

export const list = style({
  listStyle: 'none',
  margin: '12px 0 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  maxHeight: '50dvh',
  overflowY: 'auto',
});

export const item = style({
  position: 'relative',
  paddingLeft: 18,
  fontSize: 14,
  lineHeight: 1.5,
  color: cssVarV2('text/primary'),
});

globalStyle(`${item}::before`, {
  content: '""',
  position: 'absolute',
  left: 2,
  top: '0.6em',
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--affine-primary-color, #6f7f54)',
});

export const footer = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 24,
});
