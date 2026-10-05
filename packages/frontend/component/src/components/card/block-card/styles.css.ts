import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';
export const blockCard = style({
  display: 'flex',
  gap: '12px',
  padding: '12px 14px',
  color: cssVar('textPrimaryColor'),
  backgroundColor: 'rgba(111, 127, 84, 0.08)',
  border: '1px solid rgba(111, 127, 84, 0.16)',
  borderRadius: '18px',
  userSelect: 'none',
  cursor: 'pointer',
  textAlign: 'start',
  boxShadow: '0 8px 20px rgba(16, 24, 12, 0.1)',
  transition:
    'background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      backgroundColor: 'rgba(111, 127, 84, 0.16)',
      borderColor: 'rgba(111, 127, 84, 0.3)',
      boxShadow: '0 12px 28px rgba(16, 24, 12, 0.14)',
      transform: 'translateY(-1px)',
    },
    '&[aria-disabled]': {
      color: cssVar('textDisableColor'),
    },
    '&[aria-disabled]:hover': {
      backgroundColor: 'rgba(111, 127, 84, 0.08)',
      cursor: 'not-allowed',
    },
    // TODO active styles
  },
});
export const blockCardAround = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: 34,
  height: 34,
  borderRadius: 14,
  background: 'rgba(111, 127, 84, 0.14)',
  color: '#b9c78c',
  flexShrink: 0,
});
export const blockCardContent = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
});
export const blockCardDesc = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
});
