import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  gap: 2,
  alignItems: 'center',
  fontSize: 13,
  lineHeight: '22px',
  fontWeight: 600,
  padding: 3,
  borderRadius: 20,
  background: 'rgba(111, 127, 84, 0.08)',
  border: '1px solid rgba(111, 127, 84, 0.16)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
});

export const item = style({
  color: cssVarV2.text.secondary,
  minHeight: 32,
  padding: '5px 10px',
  borderRadius: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition:
    'background-color .16s ease, color .16s ease, box-shadow .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      color: cssVarV2.text.primary,
      background: 'rgba(111, 127, 84, 0.12)',
    },
    '&:active': {
      transform: 'translateY(1px)',
    },
    '&[data-active="true"]': {
      color: cssVarV2.text.primary,
      background:
        'linear-gradient(180deg, rgba(111, 127, 84, 0.24), rgba(111, 127, 84, 0.12))',
      boxShadow:
        '0 8px 18px rgba(16, 24, 12, 0.12), inset 0 0 0 1px rgba(185, 199, 140, 0.22)',
    },
  },
});
