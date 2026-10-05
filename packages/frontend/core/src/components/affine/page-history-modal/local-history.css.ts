import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const content = style({
  display: 'flex',
  flex: 1,
  minHeight: 0,
  gap: 16,
});
export const list = style({ width: 220, flexShrink: 0, overflowY: 'auto' });
export const version = style({
  display: 'block',
  width: '100%',
  padding: 10,
  textAlign: 'left',
  borderRadius: 8,
  color: cssVar('textPrimaryColor'),
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  selectors: {
    '&[aria-pressed="true"]': {
      background: cssVar('backgroundSecondaryColor'),
    },
  },
});
export const preview = style({ flex: 1, minWidth: 0, overflow: 'auto' });
export const actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  paddingTop: 16,
});
