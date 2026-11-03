import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const item = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 12px',
  minWidth: '54px',
  minHeight: 30,
  lineHeight: '22px',
  fontSize: cssVar('fontSm'),
  fontWeight: 500,
  color: cssVarV2('text/secondary'),
  borderRadius: 999,
  backgroundColor: 'var(--nota-row-background)',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background-color .14s ease, color .14s ease',
  ':hover': {
    color: cssVarV2('text/primary'),
    backgroundColor: cssVarV2('layer/background/tertiary'),
  },
  selectors: {
    '&[data-active="true"]': {
      color: 'var(--nota-solid-text)',
      backgroundColor: 'var(--nota-solid-background)',
    },
    '&[data-active="true"]:hover': {
      backgroundColor: 'var(--nota-solid-background-hover)',
    },
  },
});

export const itemContent = style({
  display: 'inline-block',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  textAlign: 'center',
  maxWidth: '128px',
  minWidth: '32px',
});

export const editIconButton = style({});

export const closeButton = style({
  marginRight: -6,
  borderRadius: 999,
});

export const container = style({
  display: 'flex',
  flexDirection: 'row',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
});
