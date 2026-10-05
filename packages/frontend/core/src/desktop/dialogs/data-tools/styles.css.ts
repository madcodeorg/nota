import { cssVar } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';

export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  margin: '16px 0',
});
export const scope = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '16px 0',
});
export const formats = style({
  width: '100%',
  borderCollapse: 'collapse',
  margin: '16px 0',
});
globalStyle(`${formats} th, ${formats} td`, {
  padding: 8,
  textAlign: 'left',
  borderBottom: `1px solid ${cssVar('borderColor')}`,
});
