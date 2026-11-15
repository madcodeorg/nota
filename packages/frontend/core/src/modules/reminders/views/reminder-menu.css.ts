import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const quickTime = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2.text.tertiary,
});

export const custom = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '4px 4px 0',
});

export const customLabel = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVarV2.text.secondary,
  padding: '0 4px',
});

export const timeRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 4px',
});

export const timeInput = style({
  width: 110,
});

export const error = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2.status.error,
  padding: '0 4px',
});

export const indicator = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  height: 24,
  padding: '0 8px',
  borderRadius: 6,
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: 'var(--nota-accent)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background-color .14s ease',
  ':hover': {
    backgroundColor: cssVarV2.layer.background.hoverOverlay,
  },
  selectors: {
    '&[data-state="open"]': {
      backgroundColor: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const indicatorIcon = style({
  width: 16,
  height: 16,
});
