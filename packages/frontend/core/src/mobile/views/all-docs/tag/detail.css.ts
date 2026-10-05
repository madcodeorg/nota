import { bodyEmphasized } from '@toeverything/theme/typography';
import { style } from '@vanilla-extract/css';

export const header = style({
  background:
    'linear-gradient(180deg, rgba(23, 25, 20, 0.98), rgba(16, 17, 15, 0.94))',
  color: '#ebe4d5',
});
export const headerContent = style([
  bodyEmphasized,
  {
    color: '#ebe4d5',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
]);

export const headerIcon = style({
  width: 24,
  height: 24,
  marginRight: 8,
  color: 'rgba(235, 228, 213, 0.72)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  ':before': {
    content: '""',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'currentColor',
  },
});
