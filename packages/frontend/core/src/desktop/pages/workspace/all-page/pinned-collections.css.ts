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
  minHeight: 34,
  lineHeight: '24px',
  fontSize: cssVar('fontBase'),
  color: cssVarV2('text/secondary'),
  borderRadius: 999,
  border: '1px solid rgba(111, 127, 84, 0.14)',
  backgroundColor: 'rgba(111, 127, 84, 0.06)',
  cursor: 'pointer',
  userSelect: 'none',
  boxShadow: '0 1px 2px rgba(16, 24, 12, 0.06)',
  transition:
    'background-color .16s ease, border-color .16s ease, color .16s ease, transform .16s ease, box-shadow .16s ease',
  ':hover': {
    color: cssVarV2('text/primary'),
    backgroundColor: 'rgba(111, 127, 84, 0.14)',
    borderColor: 'rgba(111, 127, 84, 0.28)',
    boxShadow: '0 8px 20px rgba(16, 24, 12, 0.12)',
    transform: 'translateY(-1px)',
  },
  selectors: {
    '&[data-active="true"]': {
      color: cssVarV2('text/primary'),
      backgroundColor: 'rgba(111, 127, 84, 0.2)',
      borderColor: 'rgba(111, 127, 84, 0.38)',
      boxShadow: 'inset 0 0 0 1px rgba(111, 127, 84, 0.16)',
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
