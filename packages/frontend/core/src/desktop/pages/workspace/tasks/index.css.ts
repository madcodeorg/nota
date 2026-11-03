import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  width: '100%',
  height: '100%',
  overflowY: 'auto',
});

export const content = style({
  maxWidth: 760,
  margin: '0 auto',
  padding: '48px 40px 80px',
});

export const header = style({
  marginBottom: 28,
});

export const title = style({
  fontSize: 28,
  fontWeight: 700,
  lineHeight: '36px',
  letterSpacing: '-0.01em',
  color: cssVarV2.text.primary,
});

export const subtitle = style({
  marginTop: 6,
  fontSize: cssVar('fontSm'),
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
});

export const empty = style({
  padding: '20px 16px',
  borderRadius: 'var(--nota-row-radius)',
  backgroundColor: 'var(--nota-row-background)',
  fontSize: cssVar('fontSm'),
  color: cssVarV2.text.secondary,
});

export const group = style({
  marginTop: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 4px 4px',
});

export const groupLabel = style({
  fontSize: cssVar('fontBase'),
  fontWeight: 700,
  color: cssVarV2.text.primary,
  selectors: {
    '&[data-overdue="true"], &[data-today="true"]': {
      color: 'var(--nota-accent)',
    },
  },
});

export const groupToggle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  transition: 'color .14s ease',
  ':hover': {
    color: cssVarV2.text.primary,
  },
});

export const groupCount = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: cssVarV2.text.tertiary,
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 'var(--nota-row-radius)',
  backgroundColor: 'var(--nota-row-background)',
  transition: 'background-color .14s ease',
  ':hover': {
    backgroundColor: cssVarV2.layer.background.tertiary,
  },
});

export const rowMain = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  textAlign: 'left',
  cursor: 'pointer',
});

export const rowText = style({
  width: '100%',
  fontSize: cssVar('fontBase'),
  lineHeight: '22px',
  color: cssVarV2.text.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    [`${row}[data-checked="true"] &`]: {
      color: cssVarV2.text.secondary,
      textDecoration: 'line-through',
    },
  },
});

export const rowSource = style({
  width: '100%',
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  color: cssVarV2.text.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const due = style({
  flexShrink: 0,
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: cssVarV2.text.secondary,
  selectors: {
    '&[data-overdue="true"], &[data-today="true"]': {
      color: 'var(--nota-accent)',
    },
  },
});
