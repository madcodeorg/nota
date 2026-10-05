import { style } from '@vanilla-extract/css';

export const folder = style({ overflowWrap: 'anywhere' });
export const switchLabel = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});
