import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const header = style({
  display: 'flex',
  width: '100%',
  height: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  padding: '0 36px',
});

export const todayButton = style({
  position: 'absolute',
  right: 0,
});

export const body = style({
  width: '100%',
  height: '100%',
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  selectors: {
    '&[data-mobile]': {
      borderTop: 'none',
    },
  },
});

export const content = style({
  maxWidth: 944,
  padding: '0px 50px',
  margin: '0 auto',
  selectors: {
    '[data-mobile] &': {
      padding: '0 24px',
    },
  },
});

export const docTitleContainer = style({
  color: cssVarV2.text.primary,
  fontSize: 40,
  lineHeight: '50px',
  fontWeight: 700,
  padding: '38px 0',
  selectors: {
    '[data-mobile] &': {
      color: '#ebe4d5',
    },
  },
});

export const placeholder = style({
  minHeight: 200,
  width: '100%',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px dashed ${cssVarV2.layer.insideBorder.border}`,
  borderRadius: 8,
  padding: '26px 32px',
  gap: 28,
  selectors: {
    '&[data-has-events="true"]': {
      alignItems: 'stretch',
      justifyContent: 'space-between',
      background: 'rgba(90, 138, 85, 0.08)',
      borderColor: 'rgba(118, 142, 84, 0.44)',
    },
    '[data-mobile] &': {
      flexDirection: 'column',
      background: 'rgba(22, 23, 20, 0.82)',
      borderColor: 'rgba(207, 197, 169, 0.36)',
    },
  },
});

export const placeholderMain = style({
  minWidth: 230,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
});

export const placeholderIcon = style({
  width: 36,
  height: 36,
  borderRadius: 36,
  backgroundColor: cssVarV2.button.emptyIconBackground,
  color: cssVarV2.icon.primary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  marginBottom: 4,
  selectors: {
    '[data-mobile] &': {
      backgroundColor: 'rgba(235, 228, 213, 0.08)',
      color: 'rgba(235, 228, 213, 0.58)',
    },
  },
});

export const placeholderText = style({
  fontSize: 14,
  lineHeight: '22px',
  marginBottom: 16,
  color: cssVarV2.text.tertiary,
  selectors: {
    '[data-mobile] &': {
      color: 'rgba(235, 228, 213, 0.58)',
    },
  },
});

export const placeholderEvents = style({
  width: 360,
  maxWidth: '46%',
  minWidth: 280,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 10,
  selectors: {
    '[data-mobile] &': {
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
    },
  },
});

export const placeholderEventsHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: cssVarV2.text.secondary,
});

export const placeholderEventsList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const placeholderEvent = style({
  display: 'grid',
  gridTemplateColumns: '76px minmax(0, 1fr)',
  gap: 12,
  padding: '8px 10px',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.04)',
  boxShadow: 'inset 0 0 0 1px rgba(118, 142, 84, 0.22)',
});

export const placeholderEventTime = style({
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2.text.secondary,
});

export const placeholderEventBody = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const placeholderEventTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 500,
  color: cssVarV2.text.primary,
});

export const placeholderEventMeta = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2.text.secondary,
});

export const placeholderEventLink = style({
  width: 'fit-content',
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 600,
  color: cssVarV2.text.link,
  textDecoration: 'none',
  selectors: {
    '&:hover': {
      textDecoration: 'underline',
    },
  },
});
