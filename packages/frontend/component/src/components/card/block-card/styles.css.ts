import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';
export const blockCard = style({
  display: 'flex',
  gap: '12px',
  padding: '12px 14px',
  color: cssVar('textPrimaryColor'),
  backgroundColor: 'var(--nota-row-background)',
  border: '1px solid transparent',
  borderRadius: 'var(--nota-row-radius, 10px)',
  userSelect: 'none',
  cursor: 'pointer',
  textAlign: 'start',
  transition:
    'background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease',
  selectors: {
    '&:hover': {
      backgroundColor: cssVar('backgroundTertiaryColor'),
    },
    '&[aria-disabled]': {
      color: cssVar('textDisableColor'),
    },
    '&[aria-disabled]:hover': {
      backgroundColor: 'var(--nota-row-background)',
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
  borderRadius: 'var(--nota-control-radius, 8px)',
  background: cssVar('backgroundPrimaryColor'),
  color: cssVar('iconColor'),
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
