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
  marginBottom: 24,
});

export const title = style({
  fontSize: 28,
  fontWeight: 600,
  lineHeight: '36px',
  color: cssVarV2.text.primary,
});

export const subtitle = style({
  marginTop: 6,
  fontSize: cssVar('fontSm'),
  color: cssVarV2.text.secondary,
});

export const empty = style({
  padding: '32px 0',
  fontSize: cssVar('fontSm'),
  color: cssVarV2.text.secondary,
});

export const group = style({
  marginTop: 20,
});

export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  marginBottom: 4,
});

export const groupLabel = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2.text.primary,
  selectors: {
    '&[data-overdue="true"]': {
      color: cssVarV2.status.error,
    },
  },
});

export const groupToggle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  ':hover': {
    color: cssVarV2.text.primary,
  },
});

export const groupCount = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2.text.tertiary,
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 4px',
  borderRadius: 6,
  ':hover': {
    backgroundColor: cssVarV2.layer.background.hoverOverlay,
  },
});

export const rowMain = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textAlign: 'left',
  cursor: 'pointer',
});

export const rowText = style({
  width: '100%',
  fontSize: cssVar('fontBase'),
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
  color: cssVarV2.text.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const due = style({
  flexShrink: 0,
  fontSize: cssVar('fontXs'),
  color: cssVarV2.text.secondary,
  selectors: {
    '&[data-overdue="true"]': {
      color: cssVarV2.status.error,
    },
  },
});
