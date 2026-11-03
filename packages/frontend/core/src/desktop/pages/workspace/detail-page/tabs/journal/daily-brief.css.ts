import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const brief = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '0px 16px 10px 16px',
});

export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 4px',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
});

export const headerLink = style({
  fontSize: 12,
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  ':hover': {
    color: cssVarV2.text.primary,
  },
});

export const task = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  borderRadius: 'var(--nota-row-radius)',
  transition: 'background-color .14s ease',
  ':hover': {
    backgroundColor: cssVarV2.layer.background.hoverOverlay,
  },
});

export const taskText = style({
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  lineHeight: '22px',
  color: cssVarV2.text.primary,
  cursor: 'pointer',
  selectors: {
    [`${task}[data-checked="true"] &`]: {
      color: cssVarV2.text.secondary,
      textDecoration: 'line-through',
    },
  },
});

export const overdue = style({
  flexShrink: 0,
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--nota-accent)',
});

export const more = style({
  padding: '2px 4px',
  fontSize: 12,
  color: cssVarV2.text.tertiary,
});

export const meeting = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  minHeight: 30,
  borderRadius: 'var(--nota-row-radius)',
  transition: 'background-color .14s ease',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  ':hover': {
    backgroundColor: cssVarV2.layer.background.hoverOverlay,
  },
});

globalStyle(`${meeting} .affine-reference-title`, {
  borderBottom: 'none',
});

export const meetingTime = style({
  flexShrink: 0,
  fontSize: 12,
  color: cssVarV2.text.secondary,
});
