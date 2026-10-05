import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, style } from '@vanilla-extract/css';

export const primaryColor = createVar('calendar-event-primary');

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '0px 16px 10px 16px',
});

export const event = style({
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '6px 4px',
  borderRadius: 4,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      backgroundColor: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const eventIcon = style({
  width: 20,
  height: 20,
  color: primaryColor,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
});

export const eventContent = style({
  width: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
});

export const eventTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  fontWeight: 400,
  lineHeight: '22px',
  color: cssVarV2.text.primary,
});

export const eventMeta = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2.text.secondary,
});

export const eventLink = style({
  width: 'fit-content',
  color: primaryColor,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
  textDecoration: 'none',
  selectors: {
    '&:hover': {
      textDecoration: 'underline',
    },
  },
});

export const eventNotes = style({
  display: '-webkit-box',
  overflow: 'hidden',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2.text.secondary,
});

export const eventCaption = style({
  flex: '0 0 auto',
  paddingTop: 1,
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
});

export const eventTime = style({
  display: 'flex',
  selectors: {
    [`${event}:hover &`]: {
      display: 'none',
    },
  },
});
export const eventNewDoc = style({
  display: 'none',
  gap: 4,
  selectors: {
    [`${event}:hover &`]: {
      display: 'flex',
    },
  },
});

export const nameTooltip = style({
  backgroundColor: cssVarV2.layer.background.overlayPanel,
  padding: '8px 6px',
  boxShadow: cssVar('overlayPanelShadow'),
});
export const nameTooltipContent = style({
  display: 'flex',
  gap: 8,
  paddingRight: 8,
  alignItems: 'center',
});
export const nameTooltipIcon = style({
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ':before': {
    content: '',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'currentColor',
    display: 'block',
  },
});
export const nameTooltipName = style({
  fontSize: 14,
  lineHeight: '22px',
  color: cssVarV2.text.primary,
});
