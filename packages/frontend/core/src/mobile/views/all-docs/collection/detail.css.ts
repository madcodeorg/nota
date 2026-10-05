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
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#ebe4d5',
  },
]);

export const headerIcon = style({
  fontSize: 24,
  color: 'rgba(235, 228, 213, 0.72)',
});
