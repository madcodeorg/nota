import { bodyEmphasized } from '@toeverything/theme/typography';
import { style } from '@vanilla-extract/css';

export const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 58,
  padding: '9px 12px',
  borderRadius: 18,
  border: '1px solid rgba(207, 197, 169, 0.16)',
  background: 'rgba(26, 27, 23, 0.82)',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.24)',
  backdropFilter: 'blur(12px)',
});

export const label = style([
  bodyEmphasized,
  {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    color: '#ebe4d5',
    fontSize: 18,
    lineHeight: '24px',
    fontWeight: 700,
    letterSpacing: '0',
  },
]);

export const dropdownIcon = style({
  fontSize: 24,
  color: 'rgba(235, 228, 213, 0.56)',
});
