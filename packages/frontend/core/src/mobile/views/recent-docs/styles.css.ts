import { globalStyle, style } from '@vanilla-extract/css';

export const recentSection = style({
  paddingBottom: 32,
  selectors: {
    '&[data-state="open"]': {
      paddingBottom: 0,
    },
  },
});
export const scroll = style({
  width: '100%',
  paddingTop: 12,
  paddingBottom: 34,
  overflowX: 'auto',
});

export const list = style({
  paddingLeft: 16,
  paddingRight: 16,
  display: 'flex',
  gap: 14,
  width: 'fit-content',
});

export const cardWrapper = style({
  width: 186,
  height: 222,
  flexShrink: 0,
});

export const header = style({
  margin: '0 8px',
});

globalStyle(`${cardWrapper} > *`, {
  width: '100%',
  height: '100%',
});
