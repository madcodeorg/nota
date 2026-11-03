import { style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: '2px',
});

export const button = style({
  width: '28px',
  height: '28px',
  flexShrink: 0,
});
